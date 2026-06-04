# MealScout Parking Pass Page Decomposition Map

This map documents how to understand and eventually decompose `client/src/pages/parking-pass.tsx` without changing runtime behavior. It is docs/contracts only and does not authorize booking, payment, host, schedule, or live-location behavior changes.

## 1. Current File

Current owner file: `client/src/pages/parking-pass.tsx`

Why it is dangerous:

- It owns the public Parking Pass booking surface, truck schedule tools, host listing tools, Stripe checkout handoff, map/search, social sharing, reports, manual schedule stops, and live-location updates in one file.
- It calls booking, host, truck, payment, map, social, and live-location endpoints directly.
- It contains stateful production mutations: booking start, booking cancel, host create/update/delete, Parking Pass listing create, manual schedule create/delete, report save, social post queue, social disconnect, location share, live-location mobile settings, and host blackout changes.
- Parking Pass booking eligibility depends on non-expired stored insurance verification upstream; cleanup must not loosen or bypass that gate.
- Live mutation smokes can create bookings, payment intents, host rows, schedule rows, reports, social posts, or live location state, so they require fixtures, staging, or explicit production-test-record approval.

Why it should not be refactored casually:

- Do not extract code while changing endpoint paths, query keys, status semantics, booking/cart behavior, payment modal props, selected slot behavior, map filtering, host pricing semantics, or social/live-location side effects.
- Do not mix decomposition with UI redesign, payment changes, booking-flow changes, or new product features.
- Do not run live booking/payment/host/social/location mutations as validation unless explicitly approved.

## 2. Current Major Responsibilities

- **Find & Book**: top tab `book`, public listing load from `/api/parking-pass`, date/city search, listing grouping, slot selection, booking cart, `handleBookSelected`, and payment modal handoff.
- **Host Tools**: top tab `host`, `hostToolsTab` values `listings`, `location`, and `payments`; host profile create/update/delete, spot image upload, coordinates, amenities, blackout dates, pricing, hard-cap controls, and Parking Pass listing creation.
- **My Schedule**: top tab `schedule`, truck booked schedule, manual schedule stops, schedule calendar, cancel booking, report entry, upcoming/past schedule display, and truck-side schedule tools.
- **Map/Search**: `GoogleMapPicker`, map/list view state, city query, active location, paid host filtering, cached `/api/map/locations`, `/api/parking-pass/host-ids`, supplier/fuel overlays, foot traffic, weather, and fallback host pins.
- **Payment Modal**: `BookingPaymentModal`, selected listing, selected slot types, checkout queue, cart totals, Stripe config, booking return handling via `booking=success` and `payment_intent`, and payment-intent status polling.
- **Reports**: parking reports from `/api/trucks/:truckId/parking-reports`, report draft dialog, `buildReportKey`, `handleOpenReport`, and `handleSaveReport`.
- **Social/Share**: `ShareButton`, social connection status, social settings, OAuth start/disconnect, social post queue, share prompt dialog, Facebook SDK, X share handoff, and manual share handoff.
- **Manual Schedule**: `/api/trucks/:truckId/manual-schedule`, manual schedule form, place autocomplete, manual stop creation/deletion, public/private toggle, and Premium gating for off-platform stops.
- **Live Location**: `isLive`, live leave time, `/api/restaurants/:truckId/mobile-settings`, `/api/restaurants/:truckId/location`, `/api/restaurants/:truckId/live-share-card`, and live-location share prompt.

## 3. Endpoint Inventory

Do not change endpoint paths during decomposition.

- Read/config: `/api/subscription/status`, `/api/business-access/me`, `/api/payments/stripe-config`.
- Public Parking Pass: `/api/parking-pass`, `/api/parking-pass/host-ids`, `/api/parking-pass/intelligence-status`, `/api/parking-pass/weather`.
- Booking: `/api/parking-pass/:passId/book`, `/api/bookings/truck/:truckId/schedule`, `/api/bookings/:bookingId/cancel`, `/api/bookings/payment-intent/:paymentIntentId`.
- Host tools: `/api/hosts`, `/api/hosts/:hostId`, `/api/hosts/parking-pass`, `/api/hosts/parking-pass?hostId=:hostId`, `/api/hosts/:hostId/spot-image`, `/api/hosts/:hostId/coordinates`, `/api/hosts/:hostId/blackout-dates`.
- Truck tools: `/api/restaurants/my-restaurants`, `/api/trucks/:truckId/manual-schedule`, `/api/trucks/:truckId/manual-schedule/:scheduleId`, `/api/trucks/:truckId/parking-reports`.
- Map/search: `/api/map/locations`, `/api/map/place-details/:placeId`, `/api/location/search`, `/api/map/foot-traffic`.
- Social/share/live: `/api/restaurants/:truckId/social-connections/status`, `/api/restaurants/:truckId/social-connections/:provider/start`, `/api/restaurants/:truckId/social-connections/:platform`, `/api/restaurants/:truckId/social-posts`, `/api/restaurants/:truckId/social-settings`, `/api/restaurants/:truckId/mobile-settings`, `/api/restaurants/:truckId/location`, `/api/restaurants/:truckId/live-share-card`.

## 4. State Clusters

- Access/auth state: user, subscription, business access, admin parking mode, truck access, host access, premium gating.
- Listing/booking state: `passListings`, selected listing, selected slots, selected date, selected slots by listing, cart items, checkout queue, booking return intent, pending pass/host IDs.
- Host state: host list, selected host, host profile, amenities, blackout dates, spot image, listing edit/create form, pricing, hard-cap, host tools tab.
- Schedule state: manual schedules, booked schedule, schedule form, canceling booking ID, schedule calendar, report draft, saved parking reports.
- Map/search state: map/list view, city query, active location, popup/date-picker state, map locations cache, bookable host cache, parking coordinates, overlays, weather/foot-traffic query state.
- Social/share/live state: social links, social settings, social connection status, social post prompt, posting state, live state, live leave time, share-location state.

## 5. Proposed Component Boundaries

Future components should preserve endpoint paths, query keys, props, selected slot state, cart behavior, and mutation semantics.

- `ParkingPassPageShell`: access loading, top tab routing, page header, user/truck/host mode resolution, and shared guard messaging.
- `ParkingPassFindBookTab`: public listings, date/city search, grouping, map/list toggle, selected location, slot selection, and cart summary.
- `ParkingPassMapSearchPanel`: `GoogleMapPicker`, cached map locations, paid host filtering, overlays, active location, fallback host pins, weather, and foot-traffic context.
- `ParkingPassLocationCardList`: list-mode location cards, ShareButton usage, per-slot buttons, booked truck snippets, and host detail panel.
- `ParkingPassPaymentSection`: selected listing/slot state, cart totals, `BookingPaymentModal`, Stripe readiness, payment return handling, and payment-intent polling.
- `ParkingPassHostToolsTab`: host mode shell, host tools tabs, host profile selection, and host-level capability messaging.
- `ParkingPassHostListingEditor`: Parking Pass listing creation/editing, pricing, hard cap, days of week, blackout awareness, and host listing reload.
- `ParkingPassHostLocationPanel`: create/update/delete host, geocode, coordinates, spot image, amenities, blackout dates, and payment-readiness hints.
- `ParkingPassTruckScheduleTab`: booked schedule, manual schedule list, schedule calendar, cancel booking, add stop, and premium gate messaging.
- `ParkingPassManualScheduleForm`: place autocomplete, manual stop form, public/private toggle, create/delete schedule calls, and share prompt trigger.
- `ParkingPassReportsDialog`: report draft, report fields, report save, report key handling, and report-source mapping.
- `ParkingPassSocialSharePanel`: social connections, social settings, OAuth/disconnect, share prompt dialog, platform toggles, social post queue, and manual share handoff.
- `ParkingPassLiveLocationPanel`: live state, leave time, mobile-settings writes, location updates, live share card, and live share prompt.

## 6. Extraction Order

Use this safe order:

1. Pure display cards and static helper text.
2. Read-only list cards for public Parking Pass locations.
3. Map/search panel with no endpoint or filtering changes.
4. Schedule calendar display and booked/manual schedule read models.
5. Reports dialog with existing payload shape preserved.
6. Social/share settings display before social mutation handlers.
7. Host location display before host create/update/delete controls.
8. Host listing create/edit panel, preserving pricing and hard-cap payloads.
9. Payment modal wrapper, preserving `BookingPaymentModal` props and booking return handling.
10. Shared hooks/API clients only after component boundaries and contracts stay green.

## 7. Do-Not-Touch Rules

- Do not change endpoint paths.
- Do not change booking eligibility.
- Do not change insurance verification requirements for Parking Pass booking eligibility.
- Do not change Stripe/payment intent behavior.
- Do not change `BookingPaymentModal` prop semantics.
- Do not change selected slot, cart, fee, or host-price calculations.
- Do not change Parking Pass listing visibility rules.
- Do not change host create/update/delete behavior.
- Do not change manual schedule create/delete behavior.
- Do not change social OAuth, social post queue, or manual share handoff behavior.
- Do not change live-location write behavior.
- Do not introduce new features.
- Do not run live booking/payment/host/social/location mutations without fixtures, staging, or explicit approval.

## 8. Required Validations

Run after any future touch to `client/src/pages/parking-pass.tsx`:

- `node scripts/mealscout-parking-pass-decomposition-map.contract.test.ts`
- `node scripts/mealscout-launch-board-sql-safety-map.contract.test.ts`
- `node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`
- `node scripts/mealscout-route-map.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`

If live probes are inappropriate in local development, use `SKIP_LIVE_PROBES=true npm run gate:production`; production deploys should run live probes enabled.

## 9. Exit Criteria For Future Refactor

A future developer can extract one component only when:

- Contract tests remain green.
- No endpoint names changed.
- No query keys changed.
- No booking eligibility changed.
- No payment behavior changed.
- No mutation behavior changed.
- Visual behavior is preserved.
- Component has a clear prop boundary.
- The extraction is one narrow component or panel, not a cross-cutting behavior rewrite.

## 10. Validation Ownership

- Production gate protects `/parking-pass` public reachability and read-only production assumptions.
- Booking/payment behavior should remain protected by existing booking, Stripe, and webhook tests; live mutation smokes require fixtures/staging or explicit approval.
- Admin/Launch Board safety stays linked because Parking Pass funnel and leak diagnostics depend on booking, request-log, and host/listing semantics.
- Route map stays linked because `/parking-pass`, `/parking-pass-manage`, `/api/parking-pass/*`, `/api/hosts/parking-pass`, `/api/bookings/*`, and Stripe webhook routes are danger surfaces.

## 11. Handoff Summary

`client/src/pages/parking-pass.tsx` currently owns Find & Book, Host Tools, My Schedule, map/search, payment modal, reports, social/share, manual schedule, and live-location responsibilities. C6 does not refactor it. C6 makes future decomposition safe by naming the boundaries, extraction order, endpoint invariants, and mutation hazards before any runtime code moves.
