# MealScout Owner Dashboard Decomposition Map

This map documents how to understand and eventually decompose `client/src/pages/restaurant-owner-dashboard.tsx` without changing runtime behavior. It is docs/contracts only and does not authorize owner dashboard refactors, route changes, login/onboarding changes, Parking Pass changes, menu writes, schedule writes, verification changes, or profile-access policy changes without explicit product approval.

## 1. Current File

Current owner file: `client/src/pages/restaurant-owner-dashboard.tsx`

Why it is dangerous:

- It is the shared dashboard for `restaurant_owner` and `food_truck` users, with staff/admin access paths also present.
- It owns restaurant/truck profile setup, public profile readiness, menu entry points, live truck session controls, owner analytics, deals, bookings, media upload, QR/public profile links, onboarding completion prompts, and Parking Pass entry points in one file.
- It calls read and mutation endpoints for profile basics, location, operating hours, media uploads, deals, bookings, truck sessions, analytics export, and owner completion actions.
- It is tied to login continuation through owner-scoped `/owner-ai?...&src=onboarding&focus=...`, with `/restaurant-owner-dashboard?setup=...`, `/menu-builder`, and `/parking-pass-manage` retained as manual destinations. AI Control now also reports owner login, OAuth AI connection, and social publishing readiness; cleanup must not break that chain or the exact-revision consent boundary.
- It displays insurance and verification-related state that must not be confused with email verification, claim verification, menu discoverability, or Parking Pass booking eligibility.
- It owns browser lifecycle code for `navigator.geolocation.watchPosition`, live truck location broadcasting, and `useFoodTruckSocket`; these are high-risk GPS/WebSocket areas and must not be extracted casually.
- It owns Canvas/QR generation through `downloadQrPng`, `downloadBrandedQrAsset`, `downloadAllBrandedQrAssets`, and `downloadSocialQrGraphic`; these are high-risk asset-generation areas and must not be extracted casually.

Why it should not be refactored casually:

- Do not extract code while changing endpoint paths, query keys, setup query params, role gates, mutation payloads, cache invalidations, analytics names, deal status behavior, menu/discoverability rules, or Parking Pass access.
- Do not mix decomposition with UI redesign, role cleanup, auth/onboarding fixes, payment changes, claim/setup changes, or new product features.
- Do not run live owner profile, menu, schedule, deal, booking, truck-session, media, or analytics-export mutations as validation unless fixtures, staging, or explicit production-test-record approval exist.
- Do not move `setupMode` URL behavior, dashboard tab state, or `TabsContent` routing while this is only a mapping slice.
- Do not extract GPS/WebSocket lifecycle, Canvas/QR asset generation, profile draft save logic, or media approval/upload logic until their future contracts exist.

## 2. Current Owner Dashboard Responsibilities

- **Owner dashboard shell**: page header, selected restaurant/truck state, query-param setup mode, role access checks, dashboard switcher links, restaurant selector, loading/empty states, and shared owner navigation.
- **Selected restaurant state**: `selectedRestaurant`, `requestedRestaurantId`, setup query params, and restaurant selector behavior decide which owner entity every profile, menu, schedule, analytics, and mutation panel addresses.
- **Business access state**: `/api/business-access/me`, `manageDeals`, `manageParkingPass`, `isRestaurantOwner`, `isFoodTruck`, staff/admin access, and delegated business permissions gate owner/truck tools without changing role values.
- **Dashboard tabs**: `TabsContent` sections for active/inactive deals, analytics, credits, bookings, and food truck tools are dashboard routing state and must not be moved during mapping.
- **Restaurant owner surfaces**: `restaurant_owner` access, `/api/restaurants/my-restaurants`, profile setup, profile basics, address/location, operating hours, media/gallery/logo/cover upload, universal trial access, billing utilities, and owner completion actions.
- **Food truck owner/operator surfaces**: `food_truck` access, truck profile display, live truck session start/end, booking inquiries, schedule setup prompts, truck-specific Parking Pass entry points, and truck-session location writes.
- **Menu/profile setup surfaces**: setup prompts for profile, profile-media, menu, verification, and schedule; links to `/menu-builder?restaurantId=...`; public profile QR kit; public profile readiness and discoverability hints.
- **Profile setup/editing**: `profileDraft`, profile basics inputs, profile action links, `updateProfileBasicsMutation`, local form state, and profile save payloads are risky because stale local state could overwrite current business data.
- **Profile completion loop**: setup task cards, `profileCompletion`, `profileActionLinks`, `owner/profile-completion-action`, and setup workspace prompts drive profile/menu/schedule/live status completion.
- **Operating hours/static schedule**: operating hours save, static schedule display, schedule setup links, and schedule-readiness prompts belong to static owner scheduling, not live GPS broadcasting.
- **Live truck location / GPS / WebSocket broadcasting**: `navigator.geolocation.watchPosition`, geolocation fallback, live auto-timeout/stop broadcast behavior, truck-session start/end, location writes, and `useFoodTruckSocket` are live status responsibilities.
- **Manual schedule / Parking Pass entry points**: schedule setup links, truck schedule entry points, `/parking-pass-manage`, `/restaurant-owner-dashboard?setup=schedule`, and `/api/bookings/my-truck` booking schedule reads/cancel.
- **Deals/marketing surfaces**: deal listing, deal status updates, edit/delete, promotion cards, analytics claims/views/conversions, and profile activity summary links.
- **Analytics and Recharts rendering**: dashboard stats, favorites analytics, recommendation analytics, summary/timeseries/customer/compare analytics, Recharts charts, export CSV link, owner value attribution, and profile completion action tracking.
- **QR/canvas/social asset generation**: QR kit, `downloadQrPng`, branded QR assets, social QR graphics, Canvas rendering, canonical URL composition, and download link behavior.
- **Media upload/approval**: logo/cover/gallery file input, `uploadProfileMediaMutation`, `approveProfileMediaMutation`, media gallery display, approval state, and media delete paths.
- **Parking Pass entry points**: `canManageParkingPass`, business access permissions, `/parking-pass-manage`, truck schedule/setup links, and Parking Pass booking/schedule handoff.
- **Verification/insurance state display**: restaurant verification request/status, stored `insuranceVerified`, `insuranceExpiresAt`, claimed import state, setup verification prompts, and separation from email verification.
- **Dangerous mutation paths**: profile/location/operating-hours/profile-basics writes, media upload/delete, deal patch/delete, truck-session start/end, booking cancel, owner profile-completion action, analytics export, and location writes.

## 3. Mixed Responsibility Risks

`client/src/pages/restaurant-owner-dashboard.tsx` currently mixes responsibilities that should be separated only after contracts exist:

- GPS and WebSocket lifecycle: `navigator.geolocation.watchPosition`, geolocation clear/cleanup, live auto-timeout/stop broadcast behavior, location writes, truck-session start/end, and `useFoodTruckSocket`.
- Canvas and QR asset generation: QR code URLs, Canvas drawing, branded asset downloads, social graphic downloads, and browser download link behavior.
- Large local form/draft state: `profileDraft` and profile editing inputs can become stale relative to server business data.
- Analytics rendering: owner stats, Recharts charts, comparison metrics, export links, and owner value attribution live alongside mutation-heavy owner tools.
- Media upload/approval mutations: `uploadProfileMediaMutation`, `approveProfileMediaMutation`, gallery state, and media delete behavior.
- Profile save mutations: profile basics, location, operating hours, mobile settings, and owner completion action updates.
- Dashboard routing/tab state: `setupMode` URL handling and `TabsContent` routing are mixed with profile/menu/schedule/live-status workspaces.

## 4. Risky Mutation Areas

These paths must be mapped before any future extraction changes behavior:

- Live location auto-timeout / stop broadcast behavior.
- `navigator.geolocation.watchPosition` lifecycle and cleanup.
- `useFoodTruckSocket` lifecycle, subscription, connection, and disconnection behavior.
- `profileDraft` save/update mutation and stale-state risk.
- `uploadProfileMediaMutation` file upload behavior.
- `approveProfileMediaMutation` media approval behavior.
- Operating hours save.
- Social/QR asset download behavior, including Canvas and canonical URL generation.
- Parking Pass booking/cancel entry points where `/api/bookings/my-truck` and `/api/bookings/:bookingId/cancel` are surfaced.
- Truck-session start/end and restaurant location writes.

## 5. Related Owner Surfaces

- `client/src/pages/restaurant-owner-dashboard.tsx`: primary owner/truck dashboard surface.
- `client/src/pages/menu-builder.tsx`: owner menu creation, import, category/item writes, ordering readiness, and POS request surface.
- `client/src/pages/online-menu.tsx`: public menu display surface powered by `/api/menus/:restaurantId`.
- `client/src/pages/parking-pass.tsx`: Parking Pass public, truck schedule, host, payment, reports, social/share, manual schedule, and live-location surface.
- `client/src/pages/dashboard-router.tsx`: routes `restaurant_owner` and `food_truck` users to `/restaurant-owner-dashboard`.
- `client/src/components/dashboard-switcher.tsx`: links admin/operator switcher actions to owner/menu/Parking Pass surfaces.
- `client/src/hooks/useAuth.ts`: role-aware auth state and account-onboarding redirect guard.
- `server/services/loginContinuation.ts`: owner continuation targets for setup profile, menu, Parking Pass management, and verification.

## 6. Server Route Ownership

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

## 7. Proposed Component Boundaries

Future components should preserve endpoint paths, query keys, props, setup params, role gates, and mutation semantics.

- `OwnerDashboardShell`: auth/access state, selected restaurant/truck state, setup query params, dashboard header, dashboard switcher, restaurant selector, empty/loading states, and shared layout.
- `OwnerProfileCompletionPanel`: profile completion cards, setup task list, owner completion action tracking, public profile readiness hints, and handoff links.
- `OwnerProfileEditor`: profile basics, logo/cover/gallery upload, location/address, operating hours, public profile/QR links, and verification request display.
- `OwnerMenuPanel`: menu readiness, `/menu-builder` entry, public menu/public profile menu hints, discoverability warnings, and ordering-readiness links.
- `OwnerSchedulePanel`: static schedule, operating hours, setup schedule prompts, truck schedule reads, booking schedule display, booking cancel controls, and manual schedule/Parking Pass handoff links.
- `OwnerLiveStatusPanel`: live GPS/broadcasting state, `navigator.geolocation.watchPosition`, auto-timeout/stop broadcast behavior, truck-session start/end, restaurant location writes, and `useFoodTruckSocket` lifecycle.
- `OwnerDealsPanel`: deal list, deal status updates, edit/delete actions, deal analytics summary, and marketing/promotion cards.
- `OwnerParkingPassEntryPanel`: `canManageParkingPass`, `/parking-pass-manage`, truck/host entry copy, schedule setup handoff, and business access permission messaging.
- `OwnerVerificationStatusPanel`: restaurant verification, insurance verified/expiry display, claimed import state, and separation from email/business/claim/insurance concepts.
- `OwnerAnalyticsPanel`: stats, favorites, recommendations, summary/timeseries/customers/compare analytics, export CSV link, and owner value attribution.
- `OwnerAssetGenerator` or `BrandedQrGenerator`: QR kit display, branded Canvas asset generation, social QR graphics, canonical profile/menu/specials URLs, and download link behavior.

## 8. Static Schedule vs Live Status

- Static schedule / operating hours belongs to `OwnerSchedulePanel`.
- Live GPS/broadcasting/websocket state belongs to `OwnerLiveStatusPanel` or a future hook boundary.
- Manual schedule and Parking Pass entry points should stay separate from live broadcast state unless future contracts prove the boundary is safe.
- Do not blur static schedule, operating hours, manual schedule, live mobile signal, truck-session state, and WebSocket subscription behavior during future extraction.

## 9. Safe Extraction Order

Use this safe order:

1. Pure display cards only.
2. `OwnerAnalyticsPanel` display-only charts.
3. `OwnerVerificationStatusPanel`.
4. `OwnerProfileCompletionPanel`.
5. `OwnerMenuPanel` route/link panel.
6. `OwnerParkingPassEntryPanel` route/link panel.
7. `OwnerDealsPanel` display shell.
8. `OwnerProfileEditor` only after profile draft/save contracts exist.
9. `OwnerSchedulePanel` only after setupMode/schedule contracts exist.
10. `OwnerLiveStatusPanel` only after GPS/WebSocket lifecycle is isolated/tested.
11. `OwnerAssetGenerator` or `BrandedQrGenerator` only after QR/canvas URL behavior is documented/guarded.

## 10. Do-Not-Touch Rules

- Do not change owner routes.
- Do not change login continuation.
- Do not change Parking Pass access.
- Do not change insurance verification requirements.
- Do not change menu gating/discoverability rules.
- Do not change claim/setup flow.
- Do not change `setupMode` URL parameter behavior.
- Do not change `TabsContent` routing logic.
- Do not touch or extract Canvas/QR generation during mapping.
- Do not touch or extract `navigator.geolocation` watchers during mapping.
- Do not change WebSocket session behavior.
- Do not change endpoint paths.
- Do not change query keys.
- Do not change role gates for `restaurant_owner`, `food_truck`, staff, admin, or delegated business access.
- Do not change profile save behavior.
- Do not change profile save payloads.
- Do not change menu writes.
- Do not change schedule writes.
- Do not change deal status, edit, delete, or claim/count semantics.
- Do not change booking cancel behavior.
- Do not change truck-session start/end behavior.
- Do not change media upload/delete behavior.
- Do not change media upload/approval behavior.
- Do not change the profile-access policy without explicit product approval.
- Do not change verification, insurance, or claim semantics.
- Do not introduce new features.
- Do not run live owner/menu/schedule/deal/booking/truck-session/media mutations without fixtures, staging, or explicit approval.

## 11. Missing Docs/Tests Before Future Refactor

Future refactor work should add focused coverage before touching these areas:

- `setupMode` URL routing.
- Owner profile save payloads and `profileDraft` stale-state behavior.
- QR/canvas canonical URL generation and download behavior.
- GPS/WebSocket lifecycle and auto-timeout behavior.
- Static schedule vs live broadcast separation.
- Parking Pass entry/cancel behavior if touched.
- Profile media upload/approval.
- `TabsContent` routing logic if dashboard tabs are moved.

## 12. Required Validations

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

## 13. Exit Criteria For Future Refactor

A future developer can extract one component only when:

- Contract tests remain green.
- No endpoint names changed.
- No query keys changed.
- No owner routes changed.
- No login continuation changed.
- No Parking Pass access changed.
- No insurance verification requirements changed.
- No menu gating/discoverability rules changed.
- No setupMode URL behavior changed.
- No TabsContent routing behavior changed.
- No GPS/WebSocket lifecycle behavior changed.
- No Canvas/QR URL or download behavior changed.
- No profile save payload behavior changed.
- No media upload/approval behavior changed.
- No mutation behavior changed.
- Visual behavior is preserved.
- Component has a clear prop boundary.
- The extraction is one narrow component or panel, not a cross-cutting behavior rewrite.

## 14. Validation Ownership

- Production gate protects the public site, version route, key production routes, and read-only production assumptions.
- Route map protects `/restaurant-owner-dashboard`, `/restaurant/dashboard`, `/menu-builder`, `/menu/:restaurantId`, `/parking-pass`, `/parking-pass-manage`, and related API route boundaries.
- Admin dashboard map stays linked because admin surfaces may view or repair owner/truck/profile/verification state.
- Parking Pass decomposition map stays linked because owner/truck schedule and Parking Pass management entry points share truck, schedule, insurance, and booking assumptions.
- Auth onboarding alignment stays linked because incomplete profile, media, menu, and schedule continuation now enters owner-scoped `/owner-ai` with a focus hint, while manual dashboard/menu destinations and the separate verification setup remain available. OAuth authorization at `/owner-ai/authorize` must remain actual-owner scoped, require a usable social connection, and preserve per-revision chat consent before the AI can approve and publish.
- Future GPS/WebSocket extraction should be blocked until live location lifecycle, auto-timeout, and session cleanup are isolated and guarded.
- Future Canvas/QR extraction should be blocked until canonical QR URLs, Canvas dimensions/copy, and download filenames are documented and guarded.

## 15. Handoff Summary

`client/src/pages/restaurant-owner-dashboard.tsx` currently owns restaurant owner and food truck dashboard responsibilities across selected restaurant state, business access state, setupMode workspaces, tab routing, profile setup/editing, menu handoff, static schedule, live GPS/WebSocket status, Parking Pass entry, deals, analytics/Recharts rendering, QR/canvas asset generation, verification display, media upload/approval, and owner/truck mutation paths. C7 does not refactor it. C7 makes future decomposition safe by naming the responsibilities, component boundaries, extraction order, endpoint invariants, lifecycle hazards, and mutation hazards before any runtime code moves.
