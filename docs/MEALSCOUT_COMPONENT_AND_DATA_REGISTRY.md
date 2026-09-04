# MealScout Component and Data Registry (Starter)

Living registry for mapping visual targets to real app surfaces.

## Experience-system owners
- `client/src/components/ui/button.tsx` is the canonical MealScout button primitive and brand adapter. Reuse its approved purpose and size variants before introducing raw button styling.
- `client/src/components/share-button.tsx` is the one canonical reusable share control. The duplicate case-variant owner has been retired.
- `client/src/components/ui/` is the canonical reusable-interface directory; feature composition stays with the feature that owns the user job.

## Identity owner
- `server/unifiedAuth.ts` is the sole product-local authentication and session owner.
- `server/routes.ts` is the sole registration path for that owner.
- The dormant TradeScout SSO proposal and two unreachable auth stacks are retired.
- `users.tradescoutId` is retained as read-only migration evidence until stored-data reconciliation proves removal safe.
- This is not the Infinity-wide identity-owner decision; see `docs/MEALSCOUT_IDENTITY_BOUNDARY.md`.

## Scout page
- Likely files:
- `client/src/pages/explore-preview-v2.tsx` (canonical owner for `/scout`, `/directory`, and `/scout-v2`)
- `client/src/pages/map.tsx` (related map surface patterns)
- `client/src/components/navigation.tsx`
- Likely APIs/data sources:
- `/api/events/public`
- `/api/map/locations`
- role-aware local state and query filters inside `explore-preview-v2.tsx`
- Role/lane notes:
- consumer-first discovery surface; avoid exposing operator-only controls
- Implementation cautions:
- do not replace with directory-only UX
- preserve map + rail hierarchy + status truth labels from real data
- the retired `explore-preview.tsx` implementation and its unused lazy import must not return

## Parking Pass page
- Likely files:
- `client/src/pages/parking-pass.tsx`
- `client/src/components/booking-payment-modal.tsx`
- `server/routes/hostRoutes.ts` (booking endpoint)
- `server/routes/eventRoutes.ts` (public parking-pass feed related endpoints)
- Likely APIs/data sources:
- `/api/parking-pass`
- `/api/parking-pass/:passId/book`
- `/api/hosts`
- `/api/hosts/parking-pass`
- `/api/map/locations`
- `/api/parking-pass/host-ids`
- `/api/restaurants/my-restaurants`
- Role/lane notes:
- truck side (book/schedule/location), host side (spots/listings/payments), hybrid supports both
- Implementation cautions:
- capability enforcement is required (food-truck + manageParkingPass)
- do not fallback truck identity to non-truck restaurants

## Food truck operating tools
- Likely files:
- `client/src/pages/parking-pass.tsx` (schedule/live/social sections)
- `server/routes/restaurantOperationsRoutes.ts`
- Likely APIs/data sources:
- `/api/restaurants/my-restaurants`
- truck schedule/report routes under `/api/trucks/...`
- Role/lane notes:
- food_truck owner/staff lane with permissions
- Implementation cautions:
- do not leak staff/admin-only actions to consumer lane

## Host spot tools
- Likely files:
- `client/src/pages/parking-pass.tsx`
- `client/src/pages/parking-pass-manage.tsx`
- `server/routes/hosts/eventsRoutes.ts`
- Likely APIs/data sources:
- `/api/hosts`
- `/api/hosts/parking-pass`
- `/api/hosts/parking-pass/:passId`
- Role/lane notes:
- host lane for listing/availability/payments setup
- Implementation cautions:
- host-only users should default to host tools, not truck checkout

## Recommendation system (consumer discovery ranking surfaces)
- Likely files:
- `client/src/pages/explore-preview-v2.tsx`
- related utility selectors inside that page
- Likely APIs/data sources:
- `/api/events/public`
- `/api/map/locations`
- app-local prioritization logic per rail
- Role/lane notes:
- consumer-facing prioritization, not operator control plane
- Implementation cautions:
- keep copy plain; avoid fake confidence when data is thin

## Restaurant/truck cards
- Likely files:
- `client/src/pages/explore-preview-v2.tsx`
- `client/src/pages/parking-pass.tsx` (spot/location cards)
- `client/src/components/deal-card.tsx` (deal-linked navigation)
- Likely APIs/data sources:
- route-local aggregates from `/api/events/public`, `/api/parking-pass`, `/api/restaurants/...`
- Role/lane notes:
- same entity can appear differently by lane (consumer vs operator)
- Implementation cautions:
- avoid duplicate entity overload in early rails

## Deal cards
- Likely files:
- `client/src/components/deal-card.tsx`
- discovery pages that render deal modules
- Likely APIs/data sources:
- deal and restaurant endpoints; parking deep-link hooks exist in deal card
- Role/lane notes:
- consumer lane primarily
- Implementation cautions:
- do not imply payment/booking behavior from deal cards unless real action exists

## Event cards
- Likely files:
- `client/src/pages/explore-preview-v2.tsx`
- `client/src/pages/event-detail.tsx`
- `server/routes/eventRoutes.ts`
- Likely APIs/data sources:
- `/api/events/public`
- Role/lane notes:
- consumer discovery and event_coordinator context
- Implementation cautions:
- avoid showing stale/closed events as current

## Map surfaces
- Likely files:
- `client/src/pages/explore-preview-v2.tsx`
- `client/src/pages/map.tsx`
- `client/src/components/maps/GoogleMapPicker.tsx`
- `server/routes/publicMapRoutes.ts`
- Likely APIs/data sources:
- `/api/map/locations`
- parking host-id/status endpoints
- Role/lane notes:
- mixed lane visibility; operational overlays differ by page
- Implementation cautions:
- map controls must not block core interaction
- do not treat map as decorative when activity data exists

## Navigation
- Likely files:
- `client/src/components/navigation.tsx`
- `client/src/App.tsx` (route wiring)
- Likely APIs/data sources:
- route state + auth/user lane context
- Role/lane notes:
- lane-sensitive nav expectations
- Implementation cautions:
- preserve established placement (e.g., Saved in dashboard lane) when requested

## Checkout/payment modal
- Likely files:
- `client/src/components/booking-payment-modal.tsx`
- `server/routes/hostRoutes.ts` (`/api/parking-pass/:passId/book`)
- Likely APIs/data sources:
- Stripe config endpoint + booking endpoint
- Role/lane notes:
- operator truck booking lane only
- Implementation cautions:
- never bypass capability checks
- backend remains source of truth for authorization and food-truck enforcement
