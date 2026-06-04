# MealScout Handoff Spine

## Slice C1 Goal

Make MealScout understandable to a competent developer in one day.

KPI: after one day, the developer can explain what MealScout does, where the main routes live, how public profile/discovery works, how Parking Pass works, how owner/admin flows work, what not to touch without tests, and how to validate a change.

## Required Reading

- `WORKFLOW.md` - expected workflow entrypoint. This file is named by the cleanup slice but is not present in this checkout.
- `CLEANUP_MAP.md` - expected cleanup map. This file is named by the cleanup slice but is not present in this checkout.
- `CODEBASE_PATTERNS_OVERVIEW.md` - current architecture and pattern overview.
- `scripts/repoDoctor.mjs` - repo baseline doctor and suggested checks.
- `package.json` - available scripts and dependency surface.
- `server/routes.ts` - central server route registration.
- `client/src/App.tsx` - frontend route surface.
- `shared/schema.ts` - schema module export entrypoint.

## Production Lockdown Baseline

Feature work is frozen until production stabilization and cleanup have a repeatable baseline. Production deploys require `npm run gate:production` before release. In local dev, use `SKIP_LIVE_PROBES=true npm run gate:production` only when live probes are inappropriate; production deploys should run with live probes enabled.

Current accepted production-lockdown commits:

- `7aaa46f6` - `fix: harden indexnow key routing and config fallback`
- `0c4faf0f` - `chore: add mealscout production readiness gate`

Production truths that must remain true:

- IndexNow key routing is protected by Vercel proxy rules and backend fallback logic in `server/services/indexNow.ts`.
- `vercel.json` must route root IndexNow key files to Render before the SPA fallback.
- Parking Pass booking requires non-expired stored insurance verification. Uploaded insurance evidence alone is not enough.
- `migrations/105_restaurant_insurance_verification_expiry.sql` must be present and applied before code relying on `insurance_verified`, `insurance_verified_at`, `insurance_expires_at`, or `insurance_verified_by_user_id` deploys.
- Live mutation smokes for admin insurance verification or booking allowed/blocked states require dedicated fixtures, staging, or explicit production-test-record approval.
- Read-only production gate probes currently cover health, readiness, public profile, Scout, Parking Pass, IndexNow key URL, and admin launch-board auth protection.

## What MealScout Is

MealScout is a local food discovery, profile, scheduling, and booking platform for food trucks, restaurants, hosts, customers, suppliers, and operators.

## What MealScout Is Not

- MealScout is not Merlin.
- MealScout is not TradeScout.
- MealScout is not an unrestricted intake/OCR engine.
- MealScout is not a generic AI automation layer.
- MealScout is not a place to keep adding disconnected features.

## Core User Flows

- Customer discovery: public users browse `/scout`, `/search`, `/trending`, `/map`, city pages, deal pages, SEO landing pages, public discovery APIs, and public map APIs.
- Public profile view/action: `/p/:profileType/:profileId` and `/p/:profileType/:profileId/:profileSlug` resolve public restaurant, truck, bar, and host-like profile actions through public discovery/profile routes.
- Food truck / restaurant claim: `/claim-truck`, `/owner/verify`, `/account-setup`, `/post-verification`, `/api/truck-claims/*`, `/api/claims/*`, and admin import/claim tooling connect imported or unowned profiles to operators.
- Owner profile update: `/restaurant-owner-dashboard`, `/restaurant/dashboard`, `/business-team`, restaurant operations APIs, restaurant core APIs, media upload APIs, and profile completion APIs update canonical business records.
- Menu setup: `/menu-builder`, `/menu/:restaurantId`, `/kitchen`, `/checkout/:restaurantId`, order confirmation routes, menu APIs, and pickup order APIs manage online menu and pickup ordering.
- Schedule/manual stop update: truck live location, manual schedule, operating windows, food truck session, and booking schedule APIs keep truck availability current.
- Parking Pass host listing: `/host-signup`, `/host/dashboard`, `/parking-pass-manage`, host routes, event routes, open call series routes, and host interest routes publish and manage bookable host/event inventory.
- Parking Pass truck booking: `/parking-pass`, `/event/:slug`, event booking modals, booking APIs, event APIs, Stripe payment endpoints, and webhook reconciliation support truck-to-host booking. Booking requires non-expired stored insurance verification; uploaded insurance evidence alone is not sufficient.
- Admin Launch Board: `/admin/dashboard`, `/admin/control-center`, `/admin/geo/heatmap`, admin management routes, admin core ops routes, admin market heatmap routes, and growth routes aggregate operational launch data.
- Affiliate/claim pitch operator flow: `/share-hub`, `/affiliate/earnings`, admin affiliate routes, growth routes, claim pitch import/admin routes, affiliate share events, referrals, and claim tracking connect pitch sharing to operator conversion.
- Mobile shell route surface: Capacitor is configured in `capacitor.config.ts`; mobile-safe public routes include `/scout`, `/search`, `/map`, `/parking-pass`, `/p/*`, `/menu/*`, `/checkout/*`, auth setup routes, and public SEO/customer routes from `client/src/App.tsx`.

## Entry Routes

### Public Customer Routes

- `/`, `/scout`, `/search`, `/trending`, `/map`, `/deals`, `/deals/featured`, `/deals/:city`, `/deal/:id`, `/restaurant/:id`, `/truck/:slug`, `/bar/:slug`, `/location/:slug`, `/city/:city`, `/city/:city/:mode`, `/food-trucks/:citySlug`, `/food-trucks/:citySlug/:cuisineSlug`, `/food-trucks-today/:city`, `/deals-today/:city`, `/events-today/:city`, `/locations-with-trucks/:city`, `/category/:category`, `/cuisine/:type`, `/cuisine/:cuisine/:city`, `/video`, `/video/:id`, `/events`, `/events/public`, `/event/:slug`, `/p/:profileType/:profileId`, `/p/:profileType/:profileId/:profileSlug`, `/menu/:restaurantId`, `/checkout/:restaurantId`, `/order-confirmation/:orderId`, `/suppliers`, `/suppliers/:supplierId`, `/supplier/:slug`, `/scoutcoin`.

### Owner / Truck Routes

- `/restaurant-signup`, `/claim-truck`, `/owner/verify`, `/account-setup`, `/post-verification`, `/restaurant-owner-dashboard`, `/restaurant/dashboard`, `/deal-creation`, `/deal-edit/:dealId`, `/subscribe`, `/business-team`, `/business-team/accept`, `/menu-builder`, `/kitchen`, `/truck-discovery`.

### Host Routes

- `/host-signup`, `/host/dashboard`, `/event-coordinator/dashboard`, `/events`, `/events/public`, `/event/:slug`, `/parking-pass-manage`.

### Admin / Staff Routes

- `/admin`, `/admin/login`, `/admin/dashboard`, `/admin/control-center`, `/admin/incidents`, `/admin/tickets`, `/admin/moderation`, `/admin/moderation/queue`, `/admin/moderation/videos`, `/admin/moderation/metrics`, `/admin/moderation/appeals`, `/admin/audit-logs`, `/admin/vac-logs`, `/admin/telemetry`, `/admin/geo-ads`, `/admin/geo/heatmap`, `/admin/affiliates`, `/admin/giveaway-wheel`, `/admin/switcher`, `/admin/oauth-setup`, `/staff`.

### Booking / Parking Pass Routes

- `/parking-pass`, `/parking-pass-manage`, `/host/dashboard`, `/event-coordinator/dashboard`, `/events`, `/events/public`, `/event/:slug`, `/checkout/:restaurantId`, `/order-confirmation/:orderId`.

### Mobile-Safe Routes

- `/scout`, `/search`, `/map`, `/parking-pass`, `/p/:profileType/:profileId`, `/menu/:restaurantId`, `/checkout/:restaurantId`, `/order-confirmation/:orderId`, `/login`, `/customer-signup`, `/restaurant-signup`, `/claim-truck`, `/forgot-password`, `/reset-password`, `/change-password`, `/account-setup`, `/owner/verify`, `/post-verification`, `/install`, `/status`.

### Legacy / Danger Routes

- `/scout-prototype`, `/food-truck-rush`, public `/deal-creation`, `/admin` as both login entry and admin prefix, `/owner/verify`, `/share-hub`, `/pensacola/spots`, `/pensacola/report`, comparison/SEO routes, and duplicate guest/authenticated route definitions in `client/src/App.tsx` need careful route-boundary checks before changes.

## Server Route Groups

### Auth / Account

- `setupUnifiedAuth(app)` in `server/unifiedAuth.ts` wires local auth, Google OAuth, Facebook OAuth, TradeScout SSO compatibility, password reset, email verification, setup tokens, phone auth, login, logout, and registration routes.
- `registerAuthAccountRoutes`, `registerBusinessTeamRoutes`, `registerNotificationRoutes`, and `registerStaffRoutes` cover current user state, settings, addresses, location context, business team access, notifications, staff management, and admin user creation surfaces.

### Public Discovery / Profile / SEO / Search

- `registerPublicDiscoveryRoutes`, `registerPublicMapRoutes`, `registerDiscoveryRoutes`, `registerDealDiscoveryRoutes`, `registerPublicSearchRoutes`, `registerPublicSeoLandingRoutes`, `registerSeoRoutes`, `registerRestaurantCoreRoutes`, `registerLocationDemandRoutes`, `registerLocationUtilityRoutes`, `registerRecommendationRoutes`, `registerScoutSurfaceRoutes`, and the `/api/signals` heartbeat cover public profiles, canonical resolution, public discovery analytics, city/search/deal discovery, maps, SEO landing pages, recommendations, and machine-readable source status.

### Restaurant / Truck Operations

- `registerRestaurantCoreRoutes`, `registerRestaurantOperationsRoutes`, `registerRestaurantSignupRoutes`, `registerClaimRoutes`, `registerTruckClaimRoutes`, `registerDealManagementRoutes`, `registerBusinessTeamRoutes`, `registerLocationUtilityRoutes`, and `registerHiringRoutes` cover business creation, owner access, profile updates, deals, claim requests, truck status, manual schedule, live location, profile completion, social/OAuth publishing checks, and hiring surfaces.

### Menu / Order

- `registerMenuRoutes` and `registerPickupOrderRoutes` cover menu builder state, public menu reads, menu item/category edits, menu media, pickup checkout, owner order views, order status updates, kitchen display needs, and Stripe-backed pickup payments.

### Host / Event / Booking

- `registerHostRoutes`, `registerOpenCallSeriesRoutes`, `registerEventRoutes`, `registerEventCoordinatorRoutes`, `registerHostInterestRoutes`, and `registerBookingRoutes` cover host profiles, events, event interests, event coordinator operations, open call series, host/truck booking views, manual truck schedules, booking requests, and Parking Pass availability.

### Parking Pass / Payment / Webhook

- `registerHostRoutes`, `registerBookingRoutes`, `registerEventRoutes`, `registerStripeWebhookRoutes`, `registerSubscriptionRoutes`, `registerHostPayoutAdminRoutes`, `registerSupplierMarketplaceRoutes`, and `registerPickupOrderRoutes` all touch Stripe or payment-adjacent state. Reconciliation risk lives across booking creation, payment intent/session creation, webhook handling, host payouts, subscriptions, supplier orders, and pickup orders.

### Admin / Staff

- `registerAdminManagementRoutes`, `registerAdminCoreOpsRoutes`, `registerTruckImportAdminRoutes`, `registerUserAdminRoutes`, `registerAffiliateAdminRoutes`, `registerVerificationAdminRoutes`, `registerDealAdminRoutes`, `registerAdminMarketHeatmapRoutes`, `registerGeoAdRoutes`, `registerHostPayoutAdminRoutes`, `registerSupportRoutes`, `registerModerationRoutes`, and `registerStaffRoutes` cover Launch Board, imports, claim pitch workflows, user/business provisioning, affiliate admin, verification, deal admin, geo ads, support, moderation, and staff tooling.

### Analytics / Launch Board

- `registerAnalyticsRoutes`, `registerGrowthRoutes`, `registerAdminCoreOpsRoutes`, `registerAdminMarketHeatmapRoutes`, `registerGeoAdRoutes`, `registerPublicDiscoveryRoutes`, and `registerRestaurantOperationsRoutes` write or aggregate search, discovery, profile, geo, owner value, claim pitch, Launch Board, and market heatmap telemetry.

### Media / Uploads

- `registerMediaRoutes`, `server/imageUpload.ts`, menu media routes, profile media approval flows, and Cloudinary configuration handle image upload, storage metadata, and profile/menu media risk.

### Support / Moderation

- `registerSupportRoutes`, `registerModerationRoutes`, admin moderation pages, `shared/schema/moderation.ts`, support tickets, moderation events, profile content flags, recommendation flags, cases, resolutions, and appeals cover trust and support workflows.

### Supplier

- `registerSupplierMarketplaceRoutes` and optional `registerSupplyScoutRoutes` cover supplier catalog, supplier onboarding/profile, supplier requests, supplier orders, supplier payments, supply demand, shopping lists, price watches, barcode mappings, and optimization routes.

### Growth / Referral

- `registerGrowthRoutes`, admin affiliate routes, share hub, referrals, affiliate links/clicks/commissions, affiliate share events, claim pitch status, email sequence sends, host partner leads, report leads, and social post queue form the current growth and referral surface.

## Data Tables

The schema entrypoint is `shared/schema.ts`. It re-exports modular schema files, and the critical tables below are currently defined in `shared/schema/legacy.ts` unless noted.

- `users`: account identity, user type, auth relationships, ownership linkage, admin role risk, and super-admin assumptions.
- `restaurants`: canonical business/truck/bar profile records; owner linkage, public profile fields, imported profile state, discovery eligibility, and schema drift are high risk.
- `menus`, `menu_categories`, `menu_items`, `menu_item_photos`, `menu_item_variants`, `menu_item_modifiers`, `menu_import_logs`: owner-managed menu and public ordering state; risk centers on owner access, public reads, Stripe checkout assumptions, and media state.
- `hosts`: host profiles and Parking Pass ownership; risk centers on host ownership checks, geocoding, payout/payment fields, and public listing eligibility.
- `events`, `event_series`, `event_interests`, `event_bookings`: Parking Pass/event inventory, recurring open calls, booking state, and accepted truck counts; risk centers on capacity, date/time normalization, and payment reconciliation.
- `truck_import_listings`, `truck_import_batches`, `truck_claim_requests`: imported truck evidence, claim pitch, claim status, rawData JSON, and conversion tracking; risk centers on imported data shape and rawData status assumptions.
- `truck_manual_schedules`, `food_truck_sessions`, `food_truck_locations`, `truck_parking_reports`: truck stop, live location, schedule, and availability signals; risk centers on stale location data and route/date interpretation.
- `request_logs`, `telemetry_events`, `search_query_events`, `geo_ad_events`, `geo_location_pings`: telemetry and request observability; risk centers on high-volume writes, privacy, and Launch Board aggregation assumptions.
- `affiliate_share_events`, `affiliate_links`, `affiliate_clicks`, `affiliate_commissions`, `affiliate_wallet`, `affiliate_withdrawals`, `referrals`, `referral_clicks`, `affiliate_commission_ledger`: affiliate/referral tracking; risk centers on attribution and payout math.
- `image_uploads`, profile media approval tables, and menu photo tables: uploaded image metadata and approval state; risk centers on public/private media boundaries and Cloudinary availability.
- Supplier tables: `suppliers`, `supplier_products`, `supplier_requests`, `supplier_request_items`, `supplier_orders`, `supplier_order_items`, `supply_demands`, `supply_receipts`, `supply_items`, `supply_prices`, `supply_shopping_lists`, `supply_price_watches`, and related supply tables; risk centers on buyer/supplier ownership and payment/order state.
- Pickup order tables: `pickup_orders`, `pickup_order_items`, `order_notifications`, plus menu tables; risk centers on checkout totals, order status, kitchen display, and Stripe fee assumptions.
- Subscription/payment tables: `restaurant_subscriptions`, `credit_ledger`, `host_earnings_ledger`, `host_payout_requests`, `user_payout_preferences`, `restaurant_credit_redemptions`, `restaurant_settlement_batch`, supplier order payment fields, event booking payment fields, and Stripe webhook state; risk centers on duplicate payment events and reconciliation.

## External Integrations

- Stripe: initialized in `server/routes.ts` and multiple route modules when `STRIPE_SECRET_KEY` is present; frontend uses `VITE_STRIPE_PUBLIC_KEY`; webhook hardening uses `STRIPE_WEBHOOK_SECRET` and `STRIPE_WEBHOOK_FORCE_VERIFY`.
- Google Maps / location search: `GOOGLE_MAPS_API_KEY`, `GOOGLE_API_KEY`, `VITE_GOOGLE_MAPS_WEB_API_KEY`, and map IDs power geocoding, public maps, map provider selection, and location utilities.
- Cloudinary / image upload: `server/imageUpload.ts` uses `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
- Email provider: Brevo powers email/SMS/CRM paths through `BREVO_API_KEY`, list IDs, sender config, and notification mode environment values.
- Capacitor mobile shell: `capacitor.config.ts`, `android/`, and `ios/` provide the native wrapper surface.
- Render / Vercel / domain routing: `render.yaml`, `vercel.json`, `SITEMAP_SITE_URL`, `PUBLIC_BASE_URL`, `RENDER_EXTERNAL_HOSTNAME`, `RENDER_GIT_COMMIT`, and `VERCEL_GIT_COMMIT_SHA` appear in deploy, auth, health, and SEO surfaces.
- OAuth / social: Google OAuth uses `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; Facebook OAuth and social publishing checks use `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.
- TradeScout SSO compatibility: `server/unifiedAuth.ts` exposes a TradeScout SSO auth endpoint, but MealScout remains a separate product.

## Known Danger Zones

- Production gate bypass: no production deploy should skip `npm run gate:production`; `SKIP_LIVE_PROBES=true` is for local/dev constraints only.
- IndexNow routing/config: key URL, robots advertisement, backend fallback, and Vercel root `.txt` proxy must stay aligned.
- `server/routes/admin/adminCoreOpsRoutes.ts`: large Launch Board aggregation surface with SQL schema drift risk.
- `client/src/pages/admin-dashboard.tsx`: overloaded admin UI with many operational concerns in one page.
- `client/src/pages/parking-pass.tsx`: large mixed-mode Parking Pass discovery, host, booking, map, payment, and operator page.
- `client/src/pages/restaurant-owner-dashboard.tsx`: overloaded owner/truck dashboard with profile, setup, analytics, and operating controls.
- `server/routes/admin/truckImportAdminRoutes.ts`: import, claim, pitch, conversion, rawData JSON, and reconciliation logic.
- Raw `/api` calls: historically caused frontend/backend drift; prefer existing API helpers and contract tests.
- Schema column assumptions: caused Launch Board regression; verify SQL/select references against `shared/schema.ts` and migrations.
- Public/private route boundaries: `client/src/App.tsx` duplicates many routes across guest/authenticated surfaces and publicRoutePrefixes can accidentally expose or block pages.
- Payment/webhook reconciliation: Stripe state spans Parking Pass bookings, host payouts, subscriptions, pickup orders, supplier orders, and webhooks.
- Insurance verification gate: Parking Pass booking requires non-expired stored insurance verification, renewed every 365 days. Uploaded insurance evidence alone is not sufficient.
- Claim pitch status in rawData JSON: imported listing workflow stores status in a flexible field, so contracts should guard any reads/writes.

## Validation Commands

Recommended first check: `npm run gate:production`, then `npm run check`, then `npm run build`. `npm run ci:quick` is not present in `package.json` in this checkout.

Baseline commands:

- `npm run gate:production`
- `SKIP_LIVE_PROBES=true npm run gate:production` when live probes are inappropriate in dev
- `npm run check`
- `npm run build`
- `npm run test`
- `npm run verify:routes`
- `node scripts/repoDoctor.mjs`

Fast targeted cleanup-chain tests:

- `node scripts/mealscout-handoff-spine.contract.test.ts`
- `node scripts/mealscout-production-readiness-gate.contract.test.ts`
- `npx tsx scripts/admin-insurance-verification.contract.test.ts`
- `node scripts/mealscout-growth-loop.contract.test.ts`
- `node scripts/mealscout-one-market-launch-board.contract.test.ts`
- `node scripts/mealscout-claim-pitch-flow.contract.test.ts`
- `node scripts/mealscout-claim-pitch-conversion-rollup.contract.test.ts`
- `node scripts/mealscout-claim-pitch-share-pack.contract.test.ts`
- `node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts`
- `node scripts/mealscout-claim-profile-update-reconciliation.contract.test.ts`
- `node scripts/mealscout-useful-profile-demand-lift.contract.test.ts`
- `node scripts/mealscout-booking-intent-lift.contract.test.ts`
- `node scripts/mealscout-parking-pass-conversion-funnel.contract.test.ts`
- `node scripts/mealscout-parking-pass-funnel-leak-diagnostics.contract.test.ts`
- `node scripts/mealscout-parking-pass-leak-fix-queue.contract.test.ts`
- `node scripts/mealscout-leak-fix-outcome-tracking.contract.test.ts`

## Developer Onboarding Checklist

- Read `WORKFLOW.md`; if absent, confirm the intended workflow replacement before cleanup work.
- Read `CLEANUP_MAP.md`; if absent, confirm the intended cleanup map replacement before cleanup work.
- Read `CODEBASE_PATTERNS_OVERVIEW.md`.
- Read `MEALSCOUT_HANDOFF_SPINE.md`.
- Run `node scripts/repoDoctor.mjs`.
- Run `npm run gate:production`; use `SKIP_LIVE_PROBES=true npm run gate:production` only for local environments where live probes are inappropriate.
- Run `npm run check`.
- Run `npm run build`.
- Open `server/routes.ts`.
- Open `client/src/App.tsx`.
- Open `shared/schema.ts`.
- Trace one public profile route from frontend route to public discovery API to schema table.
- Trace one Parking Pass booking path from `/parking-pass` or `/event/:slug` to booking/event/payment APIs.
- Trace one admin Launch Board request through `admin-dashboard.tsx`, admin routes, and SQL/schema references.

## Cleanup Tickets

These are cleanup-only tickets to generate from Slice C1. Do not implement them as part of this slice.

- C2 - Route map consolidation: reconcile `ROUTES_MAP.md`, `client/src/App.tsx`, `server/routes.ts`, and public/private route prefixes into one maintained map.
- C3 - Admin dashboard decomposition map: identify page-level concerns in `admin-dashboard.tsx` and define extraction boundaries.
- C4 - Launch Board SQL safety contracts: add contracts around `adminCoreOpsRoutes.ts` SQL/select assumptions and schema references.
- C5 - Parking Pass page decomposition plan: map `parking-pass.tsx` modes, API calls, state clusters, and extraction order.
- C6 - Owner dashboard decomposition plan: map `restaurant-owner-dashboard.tsx` owner/truck/profile/menu/schedule concerns and extraction order.
- C7 - Raw API drift permanent guard: expand raw `/api` call detection and route/API helper expectations.
- C8 - Schema column reference guard: detect route SQL and Drizzle references that are not backed by current schema exports or migrations.
- C9 - Public/private route boundary audit: verify guest/authenticated frontend routes, publicRoutePrefixes, and server auth middleware alignment.
- C10 - Payment/webhook safety map: document and contract Stripe booking, subscription, supplier, pickup order, payout, and webhook reconciliation paths.

## Developer Hire Positioning

Bring a developer in for architecture audit, repo stabilization, route/data-flow mapping, component decomposition planning, test hardening, and handoff documentation.

Do not position the work as open-ended cleanup, a rewrite, mobile rebuild, unrestricted AI/intake expansion, or new feature work.
