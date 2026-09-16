# MealScout End-to-End Flow UX Matrix

Status: implementation control surface
Date: 2026-09-15

This matrix extends the canonical UI/UX decision packet from surfaces to complete journeys. It does not authorize API, payment, permission, pricing, booking-eligibility, or data-model changes.

## Universal acceptance contract

Every reachable flow must preserve the user's context and expose: clear entry intent; current step/state; one dominant next action; loading without layout collapse; actionable empty states; validation beside the relevant control; explicit permission/auth requirements; retryable transient failures; safe cancellation/back behavior; refresh/reload recovery where money or mutations are involved; truthful success/pending states; mobile keyboard/safe-area behavior; 44px touch targets; keyboard focus; and no hidden feature loss.

## P0 transaction flows

### Parking Pass — truck booking
Entry: Scout/profile/event/Parking Pass → find host → map/list → date → slots → review → eligibility → credits/promo → booking hold → Stripe → confirmed/pending/credited → My Schedule.

Must preserve: stored non-expired insurance verification gate, truck profile/verification gate, selected dates and slot types, host pricing/platform fees/credits/promos, idempotency, payment-intent cancellation, hostile-browser handoff, payment polling, booking return recovery, and schedule refresh.

UX acceptance: selected host/date/slots remain visible through checkout; review/pay progress is explicit; payment preparation cannot look frozen; pending is an unresolved booking outcome, not proof of received payment; payment receipt requires explicit provider/backend evidence; credited means paid but inventory lost and credits issued; closing checkout explains/release behavior; failure never implies a booking exists when it does not.

### Parking Pass — host lifecycle
Entry: host signup → host identity/location → coordinates/photos/amenities → listing → price/capacity/days → blackout dates → publish → booking activity → payout/payment readiness.

Must preserve host ownership, listing visibility, pricing/hard-cap semantics, Stripe Connect readiness and deferred settlement behavior.

UX acceptance: setup completeness is visible; destructive host/listing actions are separated; payout readiness is not confused with listing readiness; blackout/capacity conflicts are surfaced before save.

### Pickup ordering
Entry: public profile/Scout → menu → item → variant/modifiers/instructions → cart → checkout → pickup/contact → server-authoritative totals → Stripe → confirmation/status → kitchen/owner fulfillment.

Must preserve local browser cart, one-menu checkout, ordering readiness, prices-include-tax requirement, card readiness, checkoutRequestId/customerAccessToken, durable replay/reload recovery, server-authoritative totals, Stripe state, and order-confirmation access.

UX acceptance: cart belongs visibly to one business; unavailable ordering fails closed before payment; contact validation is inline; customer sees pickup business/address; estimated totals are distinguished from authoritative payment totals; reload restores/reconciles rather than duplicates; confirmation exposes preparation/ready status.

## P0 identity and onboarding

### Customer auth/account
Welcome/Scout → signup/login/OAuth → verification/setup → intended destination. Password reset/change and auth-required action recovery are included.

### Restaurant/food-truck onboarding and claim
Signup or claim → listing match/claim → verification → account setup → canonical business identity → profile completion → hours/schedule → menu/media → payment/ordering readiness → public profile.

UX acceptance: never strand a user between claim and setup; preserve source/referral/intended action; clearly distinguish imported/unclaimed/claimed/verified states; show what blocks public/ordering/booking readiness.

## P1 consumer decision flows

Scout/search/map → result selection → profile → menu/hours/schedule/location/proof → save/follow/share/directions/order/book/event/deal. Preserve map/list/query/filter context on return.

Deals: discovery → detail → validity/terms → claim/share/action → outcome.
Events: discovery → detail → interest/request/booking/payment where supported → outcome.
Saved/activity: save/follow → collection → return to current entity/action; clarify concepts where both remain distinct.
Reviews/recommendations/reporting: action → auth if required → validation → submit → visible outcome/moderation state where applicable.

## P1 operator flows

Business workspace: overview → work queue → manage profile/menu/hours/media/deals/events/team/payments/settings → save/publish outcome.
Orders/kitchen: incoming order → acknowledgement/preparation → ready/completed/cancelled state → customer status consistency.
Truck operations: booked schedule + manual stops → calendar → go live/location → serving state → share/social → report/cancel.
Team: invite → accept → permission-aware workspace → revoke/change access.

## P1 host/event flows

Host: opportunities/listings → requests/bookings → event/open-call management → blackout/capacity → settlement.
Event coordinator: create/manage event → requests/participants → public event → booking/payment where supported → completion.

## P2 marketplace/growth flows

Supplier: discover/catalog → request/cart/order → payment/status → supplier fulfillment and management.
Affiliate/referral/share: create/share attributed link → click → signup/claim/conversion → earnings/status, without obscuring attribution state.
Profile access / legacy subscriptions: verify the existing non-expiring free-trial toolset without a card, paid conversion or new monthly bill; retain access/status and cancellation of legacy recurring billing. Separate transaction charges remain unchanged. Source of truth: `shared/profileAccessPolicy.ts`; do not restore retired monthly profile checkout.
Hiring/jobs where routed: discovery/create/apply/manage states.

## P2 support/admin flows

Support: report issue/ticket → acknowledgement → status/resolution.
Moderation: queue/event/content flag → inspect → action → appeal/resolution with auditability.
Admin Launch Board/control center: identify problem → drill into business/user/market → safe action → confirmation/audit state.
Verification/import/claim-pitch: imported record → evidence → outreach/claim → verification → canonical ownership.
Payout/admin finance surfaces: pending → review → approved/rejected/settled with explicit irreversible-action confirmation.

## Cross-flow state matrix

For each flow verify: first load; slow load; empty; partial data; stale data; offline/transient network failure; 401/403; validation failure; duplicate submit; refresh mid-mutation; back navigation; deep link; mobile keyboard; small viewport; reduced motion; screen-reader labels; destructive cancellation; success; pending/reconciliation; and retry.

Payment flows additionally verify: Stripe unavailable; hostile in-app browser; intent created then modal closed; payment succeeds but webhook is delayed; inventory/availability changes during checkout; replay after reload; duplicate click; server total changes; and payment succeeds but downstream confirmation is pending.

## Implementation order

1. Shared primitives and shell resilience.
2. Parking Pass checkout + find/book state clarity (behavior frozen).
3. Pickup ordering checkout + recovery state clarity (behavior frozen).
4. Scout → profile → action continuity.
5. Restaurant/truck onboarding + claim readiness.
6. Business workspace/order/kitchen/menu workflows.
7. Host/event workflows.
8. Supplier/growth/subscription flows.
9. Support/moderation/admin flows.
10. Cross-browser screenshot + end-to-end acceptance gate.

## Definition of done

A flow is not done because its page renders. It is done when a user can enter from every supported route, understand state, complete or safely abandon the job, recover from expected failures/reloads, receive a truthful outcome, and continue to the next relevant MealScout action without losing context or capability.