# MealScout Public/Auth Route Boundary Audit

Status: C8 public/auth route boundary audit complete. This is a docs/contract-only cleanup slice. No runtime route behavior, auth middleware, roles, permissions, feature gates, payment logic, or endpoint contracts were changed.

## Scope

This audit documents the current public versus authenticated route boundary across the MealScout frontend router, backend route registration, public API reads, authenticated API mutations, optional-auth reads, and role middleware. Source of truth inspected for this slice: `client/src/App.tsx`, `server/routes.ts`, `server/unifiedAuth.ts`, `server/routes/authAccountRoutes.ts`, `server/routes/publicDiscoveryRoutes.ts`, `server/routes/publicMapRoutes.ts`, `server/routes/publicSearchRoutes.ts`, `server/routes/publicSeoLandingRoutes.ts`, `server/routes/restaurantCoreRoutes.ts`, `server/routes/restaurantOperationsRoutes.ts`, `server/routes/dealDiscoveryRoutes.ts`, `server/routes/dealManagementRoutes.ts`, `server/routes/hostRoutes.ts`, `server/routes/bookingRoutes.ts`, `server/routes/businessTeamRoutes.ts`, `server/routes/menuRoutes.ts`, `server/routes/pickupOrderRoutes.ts`, `server/routes/stripeWebhookRoutes.ts`, admin route modules, supplier route modules, `server/staffRoutes.ts`, and `server/moderationRoutes.ts`.

## Frontend Public Routes

`client/src/App.tsx` uses `publicRoutePrefixes` plus `shouldUseGuestRoutes` to keep guest-safe surfaces available before `/api/auth/user` confirms a session. The guest route set includes:

- Discovery and search: `/`, `/scout`, `/search`, `/trending`, `/map`, `/category/:category`, `/cuisine/:type`, `/cuisine/:cuisine/:city`, `/city/:city`, `/city/:city/:mode`, `/city/:city/food`, `/food-trucks/:citySlug`, `/food-trucks/:citySlug/:cuisineSlug`, `/food-trucks-today/:city`, `/deals-today/:city`, `/events-today/:city`, `/locations-with-trucks/:city`.
- Public profile/detail routes: `/restaurant/:id`, `/truck/:slug`, `/bar/:slug`, `/location/:slug`, `/location/:slug/food-trucks`, `/location/:slug/food-trucks-now`, `/location/:slug/food-trucks-tonight`, `/p/:profileType/:profileId`, `/p/:profileType/:profileId/:profileSlug`.
- Deal/event/menu/supplier public surfaces: `/deal/:id`, `/deals`, `/deals/featured`, `/deals/:city`, `/events`, `/events/public`, `/event/:slug`, `/menu/:restaurantId`, `/checkout/:restaurantId`, `/order-confirmation/:orderId`, `/suppliers`, `/supplier/:slug`, `/suppliers/:supplierId`.
- Auth entry and recovery routes: `/login`, `/customer-signup`, `/restaurant-signup`, `/host-signup`, `/claim-truck`, `/forgot-password`, `/reset-password`, `/change-password`, `/account-setup`, `/owner/verify`, `/post-verification`, `/business-team/accept`.
- Public informational routes: `/status`, `/install`, `/sitemap`, `/about`, `/contact`, `/faq`, `/how-it-works`, legal pages, comparison pages, `/hiring`, `/jobs`, `/private-chefs`, `/video`, `/video/:id`, `/parking-pass`, `/pensacola/spots`, `/pensacola/report`, `/scoutcoin`, `/food-truck-rush`, `/scout-prototype`.

Public frontend route presence does not imply public mutation permission. Several public shells can display a guest state and then call authenticated APIs only after login or an explicit authenticated action.

## Frontend Authenticated Routes

When auth is confirmed, `client/src/App.tsx` switches to the authenticated route set while retaining discovery routes for signed-in users. Auth-only or auth-oriented frontend surfaces include:

- Owner/truck operations: `/restaurant-owner-dashboard`, `/restaurant/dashboard`, `/deal-edit/:dealId`, `/subscribe`, `/menu-builder`, `/kitchen`, `/truck-discovery`, `/business-team`.
- Customer/account surfaces: `/dashboard`, `/user-dashboard`, `/favorites`, `/orders`, `/profile`, `/profile/notifications`, `/profile/settings`, `/settings`, `/profile/addresses`, `/profile/payment`, `/profile/help`, `/profile/reporter-reputation`, `/restaurant/:restaurantId/reviews`.
- Host/event/supplier operations: `/host/dashboard`, `/event-coordinator/dashboard`, `/supplier/dashboard`, `/supply/orders`, `/affiliate/earnings`.
- Admin/staff surfaces: `/staff`, `/admin/dashboard`, `/admin/control-center`, `/admin/giveaway-wheel`, `/admin/tickets`, `/admin/incidents`, `/admin/moderation`, `/admin/moderation/queue`, `/admin/moderation/videos`, `/admin/moderation/metrics`, `/admin/moderation/appeals`, `/admin/audit-logs`, `/admin/vac-logs`, `/admin/telemetry`, `/admin/geo-ads`, `/admin/geo/heatmap`, `/admin/affiliates`, `/admin/switcher`, `/admin/oauth-setup`.
- Parking Pass management: `/parking-pass-manage` is only present in the authenticated route set. `/parking-pass` remains public/auth mixed and performs gated booking or setup actions through backend checks.

The frontend route switch is not the security boundary. Backend middleware remains the enforcement boundary for account data, owner mutations, admin/staff data, payment setup, and management writes.

## Server Public API Routes

Public backend reads and guest-safe endpoints are registered through the public route groups in `server/routes.ts`:

- Public discovery/profile/SEO/search: `registerPublicDiscoveryRoutes`, `registerPublicMapRoutes`, `registerDealDiscoveryRoutes`, `registerPublicSearchRoutes`, `registerPublicSeoLandingRoutes`, `registerSeoRoutes`, `registerDiscoveryRoutes`, `registerRestaurantCoreRoutes`, `registerRecommendationRoutes`, `registerScoutSurfaceRoutes`, and the machine-readable `GET /api/signals`.
- Public profile and canonical reads include `/api/public/resolve/:entity/:slug`, `/api/public/canonical/:entity/:id`, `/api/public/profiles/:entity/:id`, `/api/public/evidence/:entity/:id`, `/api/cities`, and `/api/cities/:slug`.
- Public map and Parking Pass intelligence reads include `/api/map/runtime`, `/api/map/locations`, `/api/map/overlays`, `/api/map/route-summary`, `/api/map/place-autocomplete`, `/api/map/place-details/:placeId`, `/api/map/hosts/:hostId/upcoming-bookings`, `/api/parking-pass/weather`, and `/api/parking-pass/intelligence-status`.
- Public search and deal reads include `/api/search`, `/api/search/suggestions/:query`, `/api/deals/active`, `/api/deals/featured`, `/api/public/deals/city/:citySlug`, `/api/deals/restaurant/:restaurantId`, `/api/deals/nearby/:lat/:lng`, `/api/deals/search`, `/api/deals/recommended`, `/api/deals/:id`, and public review aggregate reads.
- Public auth/setup endpoints include registration, login, OAuth starts/callbacks, forgot/reset password, verification status/resend flows, setup token validation/completion, and public claim request/search routes where present in `setupUnifiedAuth` and `registerTruckClaimRoutes`.
- Public supplier catalog reads include `/api/suppliers`, `/api/suppliers/:supplierId`, and `/api/suppliers/:supplierId/products`.
- Public telemetry/analytics intake endpoints exist for discovery/profile analytics, deal views, geo ad tracking, telemetry tracking, location demand summaries, truck sightings, and related guest-safe reporting.
- `/api/stripe/webhook` is intentionally public to Stripe but validates webhook input through the webhook route rather than through a user session.

Public API status in this audit means "does not require a MealScout user session." It does not mean unrestricted trust; public handlers still validate parameters, sanitize output, and apply route-specific provider/signature or persistence rules where implemented.

## Server Authenticated API Routes

Authenticated backend routes use `isAuthenticated`, role middleware, ownership checks, business access helpers, or route-local owner/admin checks. Key authenticated groups are:

- Account/session/profile settings: `/api/auth/user` confirms session state, while `/api/location/context`, `/api/settings/me`, `/api/settings/public-profile/gallery`, `/api/settings/custom-domain/verify`, `/api/auth/change-temp-password`, `/api/user/addresses`, and onboarding role correction require auth.
- Owner/business mutations: restaurant creation and owner reads use `isRestaurantOwner`; restaurant operations, mobile settings, location updates, media/menu/profile changes, social/analytics owner views, and owner completion routes use `isAuthenticated` plus owner/admin/business-access checks.
- Deal and claim mutations: claimed-deal reads, deal create/update/delete, claim resolution routes, and authenticated truck claim submission use `isAuthenticated` with ownership or role checks.
- Host, event, booking, and Parking Pass writes: host profile/listing writes, Parking Pass host management, booking acceptance/cancel/update, event signup, host/event coordinator management, and truck schedule management use `isAuthenticated` plus route-local ownership/admin checks. Public schedule reads remain separate from management writes.
- Supplier operations: supplier onboarding, profile mutations, orders, supplier requests, supplier payments, shopping lists, search demand, supply intel, and optional Supply Scout routes require auth; supplier catalog reads remain public.
- Payment-adjacent routes: subscription checkout/portal/status routes, host Stripe Connect routes, supplier payment routes, pickup order management, Parking Pass booking/payment routes, and webhook reconciliation are documented here only. C9 remains the queued payment/webhook safety map and is not advanced by this audit.
- Admin/staff routes: `registerAdminManagementRoutes`, admin core ops, user admin, affiliate admin, truck import admin, verification admin, admin deals, admin geo audit, admin market heatmap, geo ads admin endpoints, host payout admin, moderation admin actions, staff management, and admin supplier-order endpoints use `isAuthenticated` with `isStaffOrAdmin`, `isAdmin`, or route-local admin-family checks.

## Middleware Alignment

`server/unifiedAuth.ts` defines the central middleware boundary:

- `isAuthenticated` returns 401 when `req.isAuthenticated()` is false.
- `isRestaurantOwner` requires a restaurant owner or admin-family user.
- `requireRole` enforces allowed roles, blocks disabled accounts, lets `super_admin` through, and lets `duper_admin`/`admin` through for non-super-admin role requirements.
- `isAdmin` covers `admin`, `duper_admin`, and `super_admin`.
- `isSuperAdmin` covers `super_admin`.
- `isStaffOrAdmin` covers `staff`, `admin`, `duper_admin`, and `super_admin`.
- `isRestaurantOwnerOrAdmin` and `isSupplierOrAdmin` provide narrower role helpers where used.

Route-local optional-auth patterns are present and should remain explicit: public discovery/deal/event/schedule/scout-surface routes may inspect `req.isAuthenticated?.()` to enrich results or include owner/admin-only state for signed-in users without making the base route private. The frontend can treat these as public reads as long as private fields remain guarded in the handler.

## Boundary Checks

- Frontend public discovery routes align with public backend reads for search, map, public profiles, SEO landing pages, public deals, public events, public menus, supplier catalog, public Parking Pass intelligence, and status/content pages.
- Frontend authenticated management routes align with backend authenticated APIs for owner dashboards, host dashboard, event coordinator dashboard, supplier dashboard, account/profile settings, business team management, Parking Pass management, staff, and admin surfaces.
- `/api/auth/user` is intentionally callable by guests and returns 401 for unauthenticated sessions; the frontend treats this as a guest-safe state through `useAuth`.
- `/parking-pass` is intentionally mixed public/authenticated: public browsing and intelligence stay public; booking and management actions are backend-gated.
- `/claim-truck` is intentionally mixed: public search/request routes exist, while authenticated claim submission is protected.
- `/business-team/accept` is publicly routable for invite handling, while `/api/business-access/me` and team management APIs are authenticated.
- `/deal-creation` is present in the guest route set, but deal mutation uses `POST /api/deals` with `isAuthenticated`; this audit records the split without changing behavior.
- Admin login routes are public entry points; admin data routes remain protected by backend middleware.
- Payment/webhook-adjacent routes were identified for boundary awareness only. The dedicated C9 safety map remains queued.

## Follow-Up Tickets

No hard public/auth boundary mismatch was found that required runtime repair in C8. Follow-ups remain documentation/cleanup discipline items:

- C9 Payment/Webhook Safety Map should produce the dedicated payment, booking, payout, Stripe Connect, supplier payment, pickup order, and webhook reconciliation boundary map before any payment-adjacent code movement.
- C10 Production Smoke Fixture Plan should define safe fixture records before stateful admin, insurance, booking, or payment smokes are added.

## Do-Not-Touch Rules

- Do not change runtime behavior as part of this C8 audit.
- Do not change auth middleware, role names, route permissions, redirects, or route registration order.
- Do not make public routes private or private routes public from this artifact.
- Do not add features, dashboards, providers, test records, sample data, fake users, or placeholder production records.
- Do not use this audit to advance C9 payment/webhook work or C10 production smoke fixtures.
