# MealScout Payment/Webhook Safety Map

Status: C9 payment/webhook safety map and focused payment-safety hardening complete. The map began as a docs/contract-only cleanup; the dedicated follow-up lane added the narrowly scoped signature, retry, replay, and out-of-order protections documented below.

## Scope

This map documents current MealScout payment, Stripe Connect, booking/payment handoff, webhook reconciliation, payment-status mutation, admin visibility, environment, and test coverage boundaries. Source of truth inspected for this slice: `server/routes.ts`, `server/routes/subscriptionRoutes.ts`, `server/routes/stripeWebhookRoutes.ts`, `server/routes/hostRoutes.ts`, `server/routes/bookingRoutes.ts`, `server/routes/eventRoutes.ts`, `server/routes/pickupOrderRoutes.ts`, `server/routes/supplierMarketplaceRoutes.ts`, `server/routes/suppliers/paymentsRoutes.ts`, `server/routes/suppliers/onboardingRoutes.ts`, `server/routes/hostPayoutAdminRoutes.ts`, `server/routes/accessPolicyDependencies.ts`, `server/utils/supplierPaymentIntent.ts`, `shared/schema/legacy.ts`, payment UI components, payment smoke/audit scripts, `scripts/preLaunchGate.mjs`, `scripts/productionReadinessGate.mjs`, `.env.example`, and `.env.production.example`.

## Payment Route Entry Points

Frontend payment surfaces:

- `client/src/pages/subscribe.tsx` uses Stripe Elements with `VITE_STRIPE_PUBLIC_KEY` and calls subscription quote/create/status routes.
- `client/src/components/event-booking-modal.tsx` handles single event/spot booking checkout with a Payment Element and server-returned `clientSecret`.
- `client/src/components/booking-payment-modal.tsx` handles Parking Pass checkout, fetches `/api/payments/stripe-config` when needed, creates checkout holds, and can cancel pending checkout by PaymentIntent.
- `client/src/pages/pickup-checkout.tsx` creates pickup orders and renders Stripe Elements when a card order returns `clientSecret`.
- `client/src/components/supply/supplier-order-payment-modal.tsx` creates supplier order PaymentIntents and confirms them through Stripe Elements.

Backend registration:

- `server/routes.ts` creates a shared `stripe` client from `STRIPE_SECRET_KEY` and passes it to subscription and supplier marketplace routes.
- `registerHostRoutes` owns public publishable-key config, host Stripe Connect onboarding/status, Parking Pass booking PaymentIntent creation, and bypass/test-mode booking branches.
- `registerEventRoutes` owns the legacy/single event Parking Pass booking PaymentIntent path and immediate client confirmation endpoint.
- `registerBookingRoutes` owns PaymentIntent lookup/cancel endpoints for Parking Pass checkout state.
- `registerSubscriptionRoutes` owns premium subscription quote, create, status, pause, and cancel routes.
- `registerPickupOrderRoutes` owns pickup order card PaymentIntent creation and owner order status management.
- `registerSupplierMarketplaceRoutes` delegates supplier online payment creation to `registerSupplierPaymentRoutes` and supplier Connect onboarding/status to `registerSupplierOnboardingRoutes`.
- `registerStripeWebhookRoutes` owns Stripe webhook event reconciliation.
- `registerHostPayoutAdminRoutes` owns admin payout request visibility, status changes, and optional Connect transfer creation for approved host payouts.

## Stripe And Payment Intent Creation Routes

Subscription/Billing:

- `POST /api/subscriptions/initialize` is authenticated and returns quotes, trial/lifetime access responses, or test-promo quote responses. It validates verified business access for restaurant owner/food truck users before paid premium setup.
- `POST /api/create-subscription` is authenticated and creates Stripe customers and subscriptions with `payment_behavior: "default_incomplete"` and `expand: ["latest_invoice.payment_intent"]`; it persists `stripeCustomerId` and `stripeSubscriptionId` on the user record.
- `GET /api/subscription/status`, `POST /api/subscription/pause`, and `POST /api/subscription/cancel` are authenticated. Cancellation sets `cancel_at_period_end`; webhook deletion later clears access state.

Parking Pass and event booking:

- `POST /api/events/:eventId/book` is guarded by `isRestaurantOwner`, requires owned truck, requires a `parking_pass` event requiring payment, inserts a pending booking, creates a platform PaymentIntent, optionally adds `application_fee_amount` and `transfer_data.destination`, then stores `stripePaymentIntentId`.
- `POST /api/parking-pass/:passId/book` is authenticated, idempotency-key guarded, rate-limited, verifies truck ownership/eligibility, creates pending holds inside a DB transaction, optionally confirms bypassed bookings when `MEALSCOUT_BYPASS_STRIPE` or test mode allows, otherwise creates a platform PaymentIntent and stores the PaymentIntent ID on all holds.
- Host payment readiness controls whether Parking Pass/event bookings use a destination charge to a connected host account or a platform-hold path for later payout.

Pickup orders:

- `POST /api/pickup-orders` is public/customer-facing. Cash orders confirm immediately with no Stripe intent. Card orders create a platform PaymentIntent with automatic payment methods, a `transfer_group`, and metadata containing pickup order and fee details; the order stores `stripePaymentIntentId` and `stripeTransferGroupId`.
- `GET /api/pickup-orders/:orderId` is public and strips Stripe intent/transfer details unless the caller is the customer or owner.
- `GET /api/pickup-orders/by-intent/:paymentIntentId` is authenticated.

Supplier marketplace:

- `POST /api/supplier-orders/:orderId/pay-intent` is authenticated, idempotency-key guarded, rate-limited, verifies buyer ownership, online payment mode, supplier Connect readiness, amount validity, payment method availability, and optional test promo authorization.
- Supplier payment intent handling can reuse, cancel and recreate, or conflict on an existing PaymentIntent through `server/utils/supplierPaymentIntent.ts`.
- Supplier online payment PaymentIntents may set `payment_method_types` to `["us_bank_account"]` for ACH or `["card"]` for card, and may use `application_fee_amount` plus `transfer_data.destination`.

Connect and payout setup:

- Host Connect onboarding in `server/routes/hostRoutes.ts` creates Stripe accounts and account links, stores `stripeConnectAccountId`, and refreshes `stripeChargesEnabled`, `stripePayoutsEnabled`, and `stripeOnboardingCompleted`.
- Supplier Connect onboarding in `server/routes/suppliers/onboardingRoutes.ts` creates Stripe accounts and account links, stores supplier Connect state, and refreshes charges/payouts/onboarding flags.
- Admin host payout marking can create a Stripe transfer to a host connected account and records a negative host earnings ledger entry.

## Booking Payment Handoff Routes

The intended Parking Pass/event lifecycle is:

- Create pending booking/holds before Stripe PaymentIntent creation.
- Store `stripePaymentIntentId` after successful PaymentIntent creation.
- Client confirms payment through Stripe Elements using `clientSecret`.
- Webhook `payment_intent.succeeded` is the durable reconciliation path.
- Immediate client confirmation via `POST /api/bookings/:bookingId/confirm` exists for single-event booking feedback and verifies PaymentIntent status through Stripe before marking the booking confirmed.
- `GET /api/bookings/payment-intent/:paymentIntentId` lets an authenticated truck owner/admin poll booking state.
- `POST /api/bookings/payment-intent/:paymentIntentId/cancel` lets an authenticated truck owner/admin cancel unreconciled pending holds and best-effort cancel the Stripe PaymentIntent.

The intended pickup order lifecycle is:

- Insert order and items, deduct tracked inventory, create Stripe PaymentIntent for card orders, store intent and transfer group.
- Webhook `payment_intent.succeeded` confirms pending pickup orders and optionally transfers subtotal to the restaurant Connect account.
- Owner status transitions then move confirmed orders through kitchen states.

The intended supplier order lifecycle is:

- Order starts unpaid/offsite/paid depending on order route and payment method.
- Online supplier orders create or reuse a Stripe PaymentIntent.
- Webhook `payment_intent.succeeded` marks supplier orders paid only when the stored intent matches.
- Webhook `payment_intent.payment_failed` marks supplier orders unpaid only when the stored intent matches.

## Webhook Route And Signature Behavior

`POST /api/stripe/webhook` is intentionally public to Stripe. Its trust boundary is signature verification, not a MealScout user session.

Current verification behavior:

- In development, signatures are verified by default; unsigned JSON payloads are accepted only when the operator explicitly sets `STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED=true` (and `STRIPE_WEBHOOK_FORCE_VERIFY` is not true). This is opt-in so a misconfigured `NODE_ENV` cannot silently accept unsigned payloads.
- Outside development, `STRIPE_WEBHOOK_SECRET` and `STRIPE_SECRET_KEY` are required and events are built with `stripe.webhooks.constructEvent(req.body, sig, endpointSecret)`.
- Signature verification requires a raw `Buffer`; a JSON-parsed body is rejected even when the signature would otherwise be valid.
- Missing server-side verification configuration returns 503. Malformed, missing, tampered, or invalid signatures return a generic 400 without exposing verifier diagnostics.
- After verification, a primary processing failure returns 500 so Stripe can retry instead of receiving a false `received: true` acknowledgment.

Handled event types:

- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `account.updated`
- `account.application.deauthorized`

Unhandled event types are logged and acknowledged without mutation.

## Webhook Reconciliation Effects

`invoice.payment_succeeded`:

- Retrieves the Stripe subscription.
- Finds the user by subscription ID.
- Updates user Stripe IDs if needed.
- Syncs `restaurantSubscriptions` rows to active monthly access for owned restaurants.
- Creates affiliate subscription commissions where applicable.
- Sends best-effort payment confirmation email.

`payment_intent.succeeded`:

- Pickup order metadata confirms still-pending pickup orders, emits kitchen updates only on the state transition, and may create a transfer to the restaurant connected account. A transfer is attempted only for a pending order atomically transitioned to confirmed by that delivery, or an already-confirmed order whose payout status still needs reconciliation; canceled, preparing, ready, completed, and other states are ineligible. Payout retries use a stable Stripe idempotency key.
- Supplier order metadata marks supplier orders paid if the stored PaymentIntent matches.
- Single event booking metadata marks booking confirmed, updates event fill state, records host earnings, sends confirmation emails, and triggers capacity notifications. A replay of an already-confirmed booking reconciles the idempotent host-earnings entry before acknowledgment.
- Parking Pass metadata confirms booking holds, writes payment success fields, updates events/fill state, records host earnings, debits credits, records booking affiliate commissions, and sends host/truck notifications. Credited cancellation and booking-credit ledger writes are PaymentIntent-keyed; replays reconcile idempotent host-earnings and credit-debit writes before acknowledgment.

`payment_intent.payment_failed`:

- Supplier order metadata marks matching supplier orders unpaid unless a succeeded event already marked the order paid.
- Only pending booking rows matching `stripePaymentIntentId` are cancelled with `stripePaymentStatus: "failed"`; an out-of-order failure event cannot regress an already-confirmed booking.

Subscription events:

- `customer.subscription.updated` deactivates matching `restaurantSubscriptions` and user deals for canceled/incomplete-expired subscriptions, then clears `stripeSubscriptionId` last; it restores the ID and subscription rows for active reactivations and inserts LISA subscription claims.
- `customer.subscription.deleted` resolves the user by subscription ID with a customer-ID fallback, deactivates matching `restaurantSubscriptions` and user deals, then clears the user subscription ID last. This remains recoverable when an earlier canceled update already cleared the subscription lookup key.

Connect account events:

- `account.updated` syncs host and supplier Connect flags.
- `account.application.deauthorized` marks matching host and supplier Connect accounts revoked/disabled for payouts.

## Payment Status Mutation Paths

Intended direct write paths discovered in code:

- `eventBookings.status`, `stripePaymentStatus`, `stripePaymentIntentId`, `paidAt`, `bookingConfirmedAt`, `stripeTransferDestination`, and related cancellation fields are written by event booking creation, Parking Pass booking creation, booking cancel/confirm routes, webhook success/failure handlers, and bypass/test-mode branches.
- `pickupOrders.status`, `confirmedAt`, `stripePaymentIntentId`, `stripeTransferGroupId`, and `payoutStatus` are written by pickup order creation, owner status management, and webhook success transfer handling.
- `supplierOrders.paymentStatus`, `stripePaymentIntentId`, charge/application/transfer amount fields, buyer discount, and buyer payment method are written by supplier order creation/request routes, supplier pay-intent route, and webhook success/failure handlers.
- `users.stripeCustomerId`, `users.stripeSubscriptionId`, and `restaurantSubscriptions` are written by subscription creation, lifetime access promo activation, subscription webhook events, first-partner access code paths, admin lifetime access routes, and backfill scripts.
- `hostEarningsLedger` and `hostPayoutRequests` are written by booking webhook handlers, host payout request flows, and admin payout processing.

These write paths are not changed by C9. Future cleanup must preserve idempotency, ownership, webhook-first reconciliation, and test/bypass isolation.

## Admin And Staff Payment Visibility

- Admin/staff user and affiliate views expose Stripe/subscription-derived diagnostics such as `stripeCustomerId`/`stripeSubscriptionId` presence, affiliate commission status, and booking-derived affiliate eligibility.
- Admin Launch Board and dashboard surfaces aggregate subscription, booking, payout, and payment-adjacent metrics through protected admin/staff endpoints.
- `/api/admin/host-payout-requests`, `/api/admin/host-payout-requests/:requestId`, and export routes require authenticated admin access.
- `/api/admin/supplier-orders` requires authenticated staff/admin access.
- Public pickup order reads intentionally strip Stripe PaymentIntent and transfer group details for non-owner callers.
- `server/utils/sanitize.ts` removes `stripeCustomerId` and `stripeSubscriptionId` from sanitized user output.

## Environment And Secret Requirements

Payment-sensitive env vars discovered:

- `STRIPE_SECRET_KEY`
- `VITE_STRIPE_PUBLIC_KEY`
- `STRIPE_PUBLIC_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_WEBHOOK_FORCE_VERIFY`
- `PRICE_MONTHLY_25`
- `MEALSCOUT_BYPASS_STRIPE`
- `MEALSCOUT_TEST_MODE`
- `MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN`
- `LIFETIME_ACCESS_CODES`
- `MEALSCOUT_LIFETIME_ACCESS_CODES`
- `LIFETIME25_ENABLED`
- `PARKING_PASS_HOLD_TTL_MINUTES`
- `PICKUP_ORDER_MEALSCOUT_FEE_CENTS`
- `PICKUP_ORDER_STRIPE_FEE_BPS`
- `PICKUP_ORDER_STRIPE_FEE_FIXED_CENTS`
- `SUPPLIER_ORDER_ACH_DEFAULT_THRESHOLD_CENTS`
- `SUPPLIER_ORDER_ACH_DISCOUNT_THRESHOLD_CENTS`
- `SUPPLIER_ORDER_ACH_DISCOUNT_CENTS`

Gate behavior:

- `scripts/preLaunchGate.mjs` treats `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLIC_KEY`, and `STRIPE_WEBHOOK_SECRET` as required and fails production bypass/test flags.
- `scripts/productionReadinessGate.mjs` treats Stripe env vars as strict-production requirements when payments are enabled, and as local-audit warnings otherwise.
- `.env.example` and `.env.production.example` now enumerate the Stripe/payment env vars listed above (see C9-F1 below).

## Test And Smoke Coverage

Existing payment/webhook coverage:

- `scripts/mealscout-stripe-webhook-verification-mode.contract.test.ts`
- `scripts/mealscout-stripe-webhook-signature-verification.behavior.test.ts`
- `scripts/mealscout-stripe-webhook-idempotency-guards.contract.test.ts`
- `scripts/mealscout-stripe-webhook-stateful-replay.integration.test.ts`
- `scripts/testEventSpotBookingPaymentContract.ts`
- `scripts/smokeParkingPassStripeFlow.ts`
- `scripts/auditParkingPassWebhookReconciliation.ts`
- `scripts/testParkingPassWebhookReplay.ts`
- `scripts/testSupplierPaymentIntentFlow.ts`
- `scripts/testSupplierPayIntentMethodSwitch.ts`
- `scripts/testMoneyButton.ts`
- `scripts/preLaunchGate.mjs`
- `scripts/productionReadinessGate.mjs`
- Package scripts include `test:stripe-webhook-safety`, `test:stripe-webhook-stateful-replay`, `smoke:parking-pass-stripe`, `audit:parking-pass-webhooks`, `test:parking-pass-webhook-replay`, `test:supplier-payments`, and `test:supplier-pay-intent-switch`.

Coverage shape:

- Production gate is read-only and verifies health, version, public route availability, admin auth guard, IndexNow, insurance gate static snippets, and env readiness.
- Parking Pass Stripe smoke is stateful and requires explicit test fixture env vars.
- Webhook replay is stateful and requires `API_BASE`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.
- Supplier intent method-switch tests are static/unit style around reuse/cancel/conflict decisions.
- Webhook verification behavior uses fabricated local-only Stripe fixture strings and the real Stripe SDK HMAC implementation; it makes no Stripe API calls.
- Webhook processing failure behavior uses an intentionally unreachable fixture database and proves a primary write failure returns 500.
- Mutation-level database idempotency remains opt-in and requires an explicitly identified disposable Neon branch and endpoint host. On 2026-07-26, the synthetic stateful replay passed signed duplicate/out-of-order delivery checks for Parking Pass host earnings and committed credit debits, pickup order confirmation and canceled-order non-regression, supplier payment non-regression, and stale/current subscription cancellation behavior.

## Audit Findings And Follow-Ups

The original C9 map made no runtime repair. The dedicated payment-safety lane subsequently applied only the signature, retry acknowledgment, payout replay, and idempotency/out-of-order guards documented above.

- C9-F1: DONE. Stripe/payment env vars are enumerated in `.env.example` and `.env.production.example` so deployers see all payment prerequisites before launch. The webhook dev bypass was also flipped to opt-in (`STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED`, default off) so a misconfigured `NODE_ENV` cannot accept unsigned payloads.
- C9-F2: In a future payment modernization slice, evaluate current raw PaymentIntent plus Payment Element flows against Stripe's current Checkout Sessions/Payment Element guidance; do not rewrite during cleanup.
- C9-F3: In a future Connect modernization slice, evaluate host/supplier `stripe.accounts.create({ type: "express" })` usage against Stripe's newer Accounts v2/controller-properties guidance; do not change existing Connect accounts during cleanup.
- C9-F4: PARTIAL. Focused webhook contracts now lock signature mode, raw-body behavior, primary-error propagation, stored-intent checks, replay reconciliation, advisory locks, and failure-event non-regression. A broader contract around every non-webhook payment status writer remains future work.
- C9-F5: DONE for isolated mutation-level replay. The reproducible stateful harness remains behind explicit disposable-branch opt-in and does not make Stripe API calls. C10 remains responsible for any production smoke fixture plan.

## Do-Not-Touch Rules

- Do not broaden this payment-safety lane into a provider, Checkout, Connect-account, pricing, subscription, or schema redesign.
- Do not weaken raw-body verification, the opt-in-only unsigned development mode, primary-error 500 behavior, or PaymentIntent-backed replay guards.
- Do not change unrelated booking, order, supplier, subscription, payout, affiliate, credit, route-auth, or provider behavior under the guise of webhook hardening.
- Do not enable production test/bypass flags or copy real credentials into examples or tests.
- Do not add sample users, fake payments, fake bookings, fake suppliers, fake hosts, or production test records.
- Do not mark C10 complete from C9.
