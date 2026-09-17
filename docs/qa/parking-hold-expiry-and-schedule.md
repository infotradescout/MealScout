# Parking Pass expiry and schedule refinement

Scope: complete safe hold-expiry handling and usable booked-stop loading/refresh without redesigning MealScout. Parent checkpoint: `753d21cd669564ac7f8f62819a667d919c51bd67`.

## Expiry contract

The scheduler uses `parkingHoldExpiry.ts`, the actual `stripePaymentIntentId` field, a bounded cursor and an overlap guard. It locks the complete payment group and requires all associated rows to remain pending, unpaid and older than the configured deadline. Fresh siblings, confirmed rows, payment evidence, unknown links and provider failures retain the booking records.

Only an exactly matched, unpaid PaymentIntent with positive `canceled` status permits the rows to become `cancelled`. Cancellation uses a stable opaque key. A lost acknowledgement is followed by a fresh read; failed or inconsistent reads do not release capacity. The service never deletes a booking. Cursor pagination prevents repeatedly deferred records from starving later candidates. Missing provider configuration does not mutate records.

Provider behavior is based on Stripe's cancellation contract (`https://docs.stripe.com/api/payment_intents/cancel`) and request-key contract (`https://docs.stripe.com/api/idempotent_requests`). Processing, succeeded and capture-pending intents are deliberately outside automatic expiry even where a provider might allow cancellation.

## Migration prerequisite

Migration142 replaces the all-history event/truck uniqueness constraint with uniqueness over pending/confirmed rows. It installs the active constraint first and never deletes conflicting data. Terminal history can then coexist with a later booking while active duplicates remain blocked. Apply this migration before deploying the new schema/expiry worker, and drain legacy workers that still delete pending holds. It has been tested only in isolated databases, not applied to production. Missing/ambiguous payment links remain a reconciliation task, not permission to delete or recreate reservations.

## Schedule contract

The new hook owns both initial fetch and refresh, keyed to account and truck. Network failures preserve explicitly marked last-known booked stops; permission failures clear them. Invalid response shapes are not converted to an empty schedule. The UI provides refresh/retry, last-checked time, and disabled booking-cancellation actions while loading or stale. Manual stops, reports, calendar navigation and existing payment/booking controls remain.

## Evidence and limits

`parking-hold-expiry.integration.test.mjs`: 40 scenarios passed against actual expiry service/Drizzle/PGlite and migration142, with synthetic provider responses. This includes grouped holds, cancellation races, failed database writes, history retention, rebooking, active uniqueness and repeat invocations. Native PostgreSQL multi-process and real Stripe-provider execution are not claimed. Docker was probed on the connected computer; its Linux engine was not running. No production accounts, bookings, payments, messages or database migrations were touched.

`parking-schedule-reliability-journeys.cjs` adds built-frontend mobile/desktop checks to the existing runner. Final integration results and exact revision are recorded in the PR checkpoint after verification. GitHub Actions is not a work dependency and its configuration is unchanged.

## Calendar navigation and final local integration

Added Today and Next scheduled day, 44px month controls, and selected-date URL persistence. An invalid booked date becomes a recoverable schedule error instead of crashing the calendar. Actual mobile/desktop screenshot review found crowded date/count text and the final spacing change has a geometry regression.

Final local results: 48/48 compiled-frontend scenarios (32 previous plus 16 schedule scenarios at desktop/mobile), 40/40 expiry cases, 22 Parking Pass source contracts, full repository typecheck and both builds. Capacity/host-truth, all six existing webhook-safety scripts and frozen-cleanup safety also passed. Final screenshots and reports are in .qa-evidence/calendar-visual-final; prior integration reports remain in expiry-schedule-apply and expiry-schedule-calendar-final. Runtime browser API/auth/Stripe are synthetic; SQL expiry tests are separate integration evidence. Actions and production remain untouched.
