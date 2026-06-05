# MealScout Owner Dashboard Decomposition Map

This map documents how to understand and eventually decompose `client/src/pages/restaurant-owner-dashboard.tsx` without changing runtime behavior. It is docs/contracts only and does not authorize owner dashboard refactors, route changes, login/onboarding changes, Parking Pass changes, menu writes, schedule writes, verification changes, or subscription gating changes.

## 1. Current File

Current owner file: `client/src/pages/restaurant-owner-dashboard.tsx`

Why it is dangerous:

- It is the shared dashboard for `restaurant_owner` and `food_truck` users, with staff/admin access paths also present.
- It owns restaurant/truck profile setup, public profile readiness, menu entry points, live truck session controls, owner analytics, deals, bookings, media upload, QR/public profile links, onboarding completion prompts, and Parking Pass entry points in one file.
- It calls read and mutation endpoints for profile basics, location, operating hours, media uploads, deals, bookings, truck sessions, analytics export, and owner completion actions.
- It is tied to login continuation through `/restaurant-owner-dashboard?setup=...`, `/menu-builder`, and `/parking-pass-manage`; cleanup must not change continuation behavior.
- It displays insurance and verification-related state that must not be confused with email verification, claim verification, menu discoverability, or Parking Pass booking eligibility.

Why it should not be refactored casually:

- Do not extract code while changing endpoint paths, query keys, setup query params, role gates, mutation payloads, cache invalidations, analytics names, deal status behavior, menu/discoverability rules, or Parking Pass access.
- Do not mix decomposition with UI redesign, role cleanup, auth/onboarding fixes, payment changes, claim/setup changes, or new product features.
- Do not run live owner profile, menu, schedule, deal, booking, truck-session, media, or analytics-export mutations as validation unless fixtures, staging, or explicit production-test-record approval exist.

## 2. Current Owner Dashboard Responsibilities

- **Owner dashboard shell**: page header, selected restaurant/truck state, query-param setup mode, role access checks, dashboard switcher links, restaurant selector, loading/empty states, and shared owner navigation.
- **Restaurant owner surfaces**: `restaurant_owner` access, `/api/restaurants/my-restaurants`, profile setup, profile basics, address/location, operating hours, media/gallery/logo/cover upload, subscription status, and owner completion actions.
- **Food truck owner/operator surfaces**: `food_truck` access, truck profile display, live truck session start/end, booking inquiries, schedule setup prompts, truck-specific Parking Pass entry points, and truck-session location writes.
- **Menu/profile setup surfaces**: setup prompts for profile, profile-media, menu, verification, and schedule; links to `/menu-builder?restaurantId=...`; public profile QR kit; public profile readiness and discoverability hints.
- **Schedule/manual stop surfaces**: schedule setup links, truck schedule entry points, `/parking-pass-manage`, `/restaurant-owner-dashboard?setup=schedule`, and `/api/bookings/my-truck` booking schedule reads/cancel.
- **Deals/marketing surfaces**: deal listing, deal status updates, edit/delete, promotion cards, analytics claims/views/conversions, and business premium weekly summary links.
- **Analytics/value attribution surfaces**: dashboard stats, favorites analytics, recommendation analytics, summary/timeseries/customer/compare analytics, export CSV link, owner value attribution, and profile completion action tracking.
- **Parking Pass entry points**: `canManageParkingPass`, business access permissions, `/parking-pass-manage`, truck schedule/setup links, and Parking Pass booking/schedule handoff.
- **Verification/insurance state display**: restaurant verification request/status, stored `insuranceVerified`, `insuranceExpiresAt`, claimed import state, setup verification prompts, and separation from email verification.
- **Dangerous mutation paths**: profile/location/operating-hours/profile-basics writes, media upload/delete, deal patch/delete, truck-session start/end, booking cancel, owner profile-completion action, analytics export, and location writes.

## 3. Related Owner Surfaces

- `client/src/pages/restaurant-owner-dashboard.tsx`: primary owner/truck dashboard surface.
- `client/src/pages/menu-builder.tsx`: owner menu creation, import, category/item writes, ordering readiness, and POS request surface.
- `client/src/pages/online-menu.tsx`: public menu display surface powered by `/api/menus/:restaurantId`.
- `client/src/pages/parking-pass.tsx`: Parking Pass public, truck schedule, host, payment, reports, social/share, manual schedule, and live-location surface.
- `client/src/pages/dashboard-router.tsx`: routes `restaurant_owner` and `food_truck` users to `/restaurant-owner-dashboard`.
- `client/src/components/dashboard-switcher.tsx`: links admin/operator switcher actions to owner/menu/Parking Pass surfaces.
- `client/src/hooks/useAuth.ts`: role-aware auth state and account-onboarding redirect guard.
- `server/services/loginContinuation.ts`: owner continuation targets for setup profile, menu, Parking Pass management, and verification.

## 4. Server Route Ownership

Do not change endpoint paths during decomposition.

- Restaurant operations: `server/routes/restaurantOperationsRoutes.ts`
  - `/api/restaurants/my-restaurants`
  - `/api/restaurants/:restaurantId/profile-basics`
  - `/api/restaurants/:restaurantId/mobile-settings`
  - `/api/restaurants/:restaurantId/location`
  - `/api/restaurants/:restaurantId/operating-hours`
  - `/api/restaurants/:restaurantId/truck-session/start`
  - `/api/restaurants/:restaurantId/truck-session/end`
  - `/api/owner/value-attribution`
  - `/api/owner/profile-completion-action`
  - `/api/restaurants/:restaurantId/analytics/summary`
  - `/api/restaurants/:restaurantId/analytics/timeseries`
  - `/api/restaurants/:restaurantId/analytics/customers`
  - `/api/restaurants/:restaurantId/analytics/compare`
  - `/api/restaurants/:restaurantId/analytics/export`
- Restaurant core: `server/routes/restaurantCoreRoutes.ts`
  - `/api/restaurants`
  - `/api/restaurants/:id`
  - `/api/restaurants/:id/verification/request`
  - `/api/restaurants/:restaurantId/analytics/favorites`
  - `/api/restaurants/:restaurantId/analytics/recommendations`
- Menu routes: `server/routes/menuRoutes.ts`
  - `/api/menus/:restaurantId`
  - `/api/owner/menus/:restaurantId`
  - `/api/owner/menus`
  - `/api/owner/menus/:menuId`
  - `/api/owner/menu-categories`
  - `/api/owner/menu-categories/:categoryId`
  - `/api/owner/menu-items`
  - `/api/owner/menu-items/:itemId`
  - `/api/owner/menus/:menuId/import/csv`
  - `/api/owner/menus/:menuId/import/pdf`
  - `/api/owner/menus/:menuId/import/external`
  - `/api/owner/menus/:menuId/pos-connection-request`
  - `/api/owner/restaurants/:restaurantId/ordering-readiness`
- Signup/claim continuation: `server/routes/restaurantSignupRoutes.ts`, `server/services/loginContinuation.ts`
  - `/api/restaurants/signup`
  - `/restaurant-owner-dashboard?setup=profile`
  - `/menu-builder`
  - `/parking-pass-manage`
  - `/restaurant-owner-dashboard?setup=verification`

## 5. Proposed Component Boundaries

Future components should preserve endpoint paths, query keys, props, setup params, role gates, and mutation semantics.

- `OwnerDashboardShell`: auth/access state, selected restaurant/truck state, setup query params, dashboard header, dashboard switcher, restaurant selector, empty/loading states, and shared layout.
- `OwnerProfileCompletionPanel`: profile completion cards, setup task list, owner completion action tracking, public profile readiness hints, and handoff links.
- `OwnerProfileEditor`: profile basics, logo/cover/gallery upload, location/address, operating hours, public profile/QR links, and verification request display.
- `OwnerMenuPanel`: menu readiness, `/menu-builder` entry, public menu/public profile menu hints, discoverability warnings, and ordering-readiness links.
- `OwnerSchedulePanel`: schedule setup prompts, truck schedule reads, booking schedule display, booking cancel controls, truck-session start/end, and manual schedule/Parking Pass handoff links.
- `OwnerDealsPanel`: deal list, deal status updates, edit/delete actions, deal analytics summary, and marketing/promotion cards.
- `OwnerParkingPassEntryPanel`: `canManageParkingPass`, `/parking-pass-manage`, truck/host entry copy, schedule setup handoff, and business access permission messaging.
- `OwnerVerificationStatusPanel`: restaurant verification, insurance verified/expiry display, claimed import state, and separation from email/business/claim/insurance concepts.
- `OwnerAnalyticsPanel`: stats, favorites, recommendations, summary/timeseries/customers/compare analytics, export CSV link, and owner value attribution.

## 6. Safe Extraction Order

Use this safe order:

1. Pure display cards and static helper text.
2. Owner dashboard shell layout with no route, auth, or selected-restaurant behavior changes.
3. Profile completion/readiness cards with existing links and copy preserved.
4. Read-only analytics cards and value attribution display.
5. Public profile/QR/menu entry display with no discoverability or menu gating changes.
6. Deals display before deal patch/delete mutation handlers.
7. Schedule and Parking Pass entry display before booking cancel or truck-session handlers.
8. Profile editor display before profile/location/operating-hours/media mutation handlers.
9. Verification/insurance status display before any verification request controls.
10. Shared hooks/API clients only after component boundaries and contracts stay green.

## 7. Do-Not-Touch Rules

- Do not change owner routes.
- Do not change login continuation.
- Do not change Parking Pass access.
- Do not change insurance verification requirements.
- Do not change menu gating/discoverability rules.
- Do not change claim/setup flow.
- Do not change endpoint paths.
- Do not change query keys.
- Do not change role gates for `restaurant_owner`, `food_truck`, staff, admin, or delegated business access.
- Do not change profile save behavior.
- Do not change menu writes.
- Do not change schedule writes.
- Do not change deal status, edit, delete, or claim/count semantics.
- Do not change booking cancel behavior.
- Do not change truck-session start/end behavior.
- Do not change media upload/delete behavior.
- Do not change subscription gating.
- Do not change verification, insurance, or claim semantics.
- Do not introduce new features.
- Do not run live owner/menu/schedule/deal/booking/truck-session/media mutations without fixtures, staging, or explicit approval.

## 8. Required Validations

Run after any future touch to `client/src/pages/restaurant-owner-dashboard.tsx`:

- `node scripts/mealscout-owner-dashboard-decomposition-map.contract.test.ts`
- `node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`
- `node scripts/mealscout-route-map.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`

If a future extraction touches menu code, also run menu-focused checks/contracts when present. If a future extraction touches Parking Pass handoff, also run `node scripts/mealscout-parking-pass-decomposition-map.contract.test.ts`.

If live probes are inappropriate in local development, use `SKIP_LIVE_PROBES=true npm run gate:production`; production deploys should run live probes enabled.

## 9. Exit Criteria For Future Refactor

A future developer can extract one component only when:

- Contract tests remain green.
- No endpoint names changed.
- No query keys changed.
- No owner routes changed.
- No login continuation changed.
- No Parking Pass access changed.
- No insurance verification requirements changed.
- No menu gating/discoverability rules changed.
- No mutation behavior changed.
- Visual behavior is preserved.
- Component has a clear prop boundary.
- The extraction is one narrow component or panel, not a cross-cutting behavior rewrite.

## 10. Validation Ownership

- Production gate protects the public site, version route, key production routes, and read-only production assumptions.
- Route map protects `/restaurant-owner-dashboard`, `/restaurant/dashboard`, `/menu-builder`, `/menu/:restaurantId`, `/parking-pass`, `/parking-pass-manage`, and related API route boundaries.
- Admin dashboard map stays linked because admin surfaces may view or repair owner/truck/profile/verification state.
- Parking Pass decomposition map stays linked because owner/truck schedule and Parking Pass management entry points share truck, schedule, insurance, and booking assumptions.
- Auth onboarding alignment stays linked because login continuation can send owners to `/restaurant-owner-dashboard?setup=profile`, `/menu-builder`, `/parking-pass-manage`, or verification setup.

## 11. Handoff Summary

`client/src/pages/restaurant-owner-dashboard.tsx` currently owns restaurant owner and food truck dashboard responsibilities across profile setup, menu handoff, schedule/Parking Pass entry, deals, analytics, verification display, media, and owner/truck mutation paths. C7 does not refactor it. C7 makes future decomposition safe by naming the responsibilities, component boundaries, extraction order, endpoint invariants, and mutation hazards before any runtime code moves.
