# MealScout Routes Map (Canonical)

## Orchestrator
- server/routes.ts
  - Creates the Express app and HTTP server
  - Validates env, wires core middleware, Socket.IO, cron
  - Registers all route modules and inline endpoints
  - Contains no domain business logic for the refactored areas

## Auth & Session
- server/unifiedAuth.ts
  - Middleware: `setupUnifiedAuth`, `isAuthenticated`, `isRestaurantOwner`, `isRestaurantOwnerOrAdmin`, `isAdmin`, `verifyResourceOwnership`
  - All `/api/auth/*` endpoints are defined in server/routes.ts and use these guards
  - Auth model: session cookies (no public write without a session)

## Host & Open Calls
- server/routes/hostRoutes.ts
  - Orchestrator / delegator for all `/api/hosts*` routes
  - Registers subroutes and retains any remaining inline endpoints not yet extracted
  - Auth: `isAuthenticated` + host ownership checks via services/hostOwnership

- server/routes/hosts/profileRoutes.ts _(extracted PR-4)_
  - Paths:
    - `POST /api/hosts`
    - `GET /api/hosts/me`
  - Auth: `isAuthenticated` + host ownership

- server/routes/hosts/eventsRoutes.ts _(extracted PR-5)_
  - Paths:
    - `POST /api/hosts/events`
    - `GET /api/hosts/events`
    - `PATCH /api/hosts/events/:eventId`
    - `PATCH /api/hosts/interests/:interestId/status`
    - `GET /api/hosts/events/:eventId/interests`
  - Auth: `isAuthenticated` + host ownership

- server/routes/hosts/shared.ts
  - Utilities: `buildLocationKey`, `buildGeocodeAddress`, `normalizeLocationValue`

- server/routes/openCallSeriesRoutes.ts
  - Paths (event series / Open Calls):
    - `POST /api/hosts/event-series`
    - `POST /api/hosts/event-series/:seriesId/publish`
    - `GET /api/hosts/event-series`
    - `GET /api/hosts/event-series/:seriesId/occurrences`
    - `POST /api/hosts/event-series/:seriesId/cancel`
  - Auth: `isAuthenticated` + host ownership checks (host must own the series)

## Truck Discovery & Interest
- server/routes/eventRoutes.ts
  - Paths:
    - `GET /api/events` (upcoming events for discovery)
    - `POST /api/events/:eventId/interests` (truck/restaurant expresses interest)
  - Auth:
    - `GET /api/events`: `isAuthenticated`
    - `POST /api/events/:eventId/interests`: `isRestaurantOwner` + ownership check on the restaurant

## Admin
- server/routes/adminManagementRoutes.ts
  - Orchestrator for classic admin management; sub-domains extracted to `server/routes/admin/`
  - Remaining paths:
    - `GET /api/auth/admin/verify`
    - `POST /api/admin/subscriptions/sync`
    - `GET /api/admin/restaurants/pending`
    - `POST /api/admin/restaurants/:id/approve`
    - `DELETE /api/admin/restaurants/:id`
    - `GET /api/admin/oauth/status`
  - Auth:
    - `GET /api/auth/admin/verify`: `isAuthenticated`, then `userType === 'admin'`
    - All `/api/admin/*`: `isAuthenticated` + `isAdmin`

- server/routes/admin/userAdminRoutes.ts
  - Paths:
    - `GET /api/admin/users`
    - `PATCH /api/admin/users/:id/status`
    - `GET /api/admin/users/:userId/addresses`
  - Auth: `isAuthenticated` + `isAdmin`

- server/routes/admin/adminCoreOpsRoutes.ts _(extracted PR-3)_
  - Paths:
    - `GET /api/admin/stats`
    - `GET /api/admin/dashboard-totals`
  - Auth: `isAuthenticated` + `isAdmin`

- server/routes/admin/dealsRoutes.ts _(extracted PR-1)_
  - Paths:
    - `GET /api/admin/deals`
    - `GET /api/admin/deals/:dealId/stats`
    - `DELETE /api/admin/deals/:dealId`
    - `POST /api/admin/deals/:dealId/clone`
    - `PATCH /api/admin/deals/:dealId/status`
    - `PATCH /api/admin/deals/:dealId/extend`
  - Auth: `isAuthenticated` + `isAdmin`

- server/routes/admin/verificationRoutes.ts _(extracted PR-2)_
  - Paths:
    - `GET /api/admin/verifications`
    - `POST /api/admin/verifications/:id/approve`
    - `POST /api/admin/verifications/:id/reject`
  - Auth: `isAuthenticated` + `isAdmin`

- server/routes/admin/shared.ts
  - Utilities: `buildLocationKey`, `buildCanonicalPath`, `toCountDeltaLine`, `formatDealValueLabel`

- server/telemetryRoutes.ts
  - Mounted in server/routes.ts as: `app.use('/api/admin/telemetry', telemetryRoutes)`
  - Paths:
    - `GET /api/admin/telemetry/velocity`
    - `GET /api/admin/telemetry/fill-rates`
    - `GET /api/admin/telemetry/decision-time`
    - `GET /api/admin/telemetry/digest-coverage`
  - Auth: `isAdmin` (read-only)

- server/evidenceExportRoutes.ts
  - Mounted in server/routes.ts as: `app.use('/api/admin', evidenceExportRoutes)`
  - Paths:
    - `GET /api/admin/export-evidence/:videoId`
  - Auth: `isAdmin` (single-item, read-only evidence export)

- server/adminRoutes.ts
  - Mounted in server/routes.ts as: `app.use('/api/admin', adminRoutes)`
  - Paths (selected):
    - `/api/admin/audit-logs`
    - `/api/admin/support-tickets*`
    - `/api/admin/moderation-events*`
    - `/api/admin/health`
    - `/api/admin/grant-lifetime-access`
    - `/api/admin/lifetime-restaurants`
    - `/api/admin/revoke-lifetime-access/:restaurantId`
    - `/api/admin/reported-videos`
    - `/api/admin/review-report/:reportId`
  - Auth: `isAdmin`

## Supplier Marketplace
- server/routes/supplierMarketplaceRoutes.ts
  - Orchestrator / residual monolith (768 lines remaining after extractions)
  - Registers all `suppliers/*` subroutes

- server/routes/suppliers/catalogRoutes.ts _(extracted PR-6)_
  - Paths:
    - `GET /api/suppliers`
    - `GET /api/suppliers/:supplierId`
    - `GET /api/suppliers/:supplierId/products`
  - Auth: `isAuthenticated`

- server/routes/suppliers/onboardingRoutes.ts _(extracted PR-11)_
  - Paths:
    - `POST /api/supplier/profile/activate`
    - `POST /api/supplier/stripe/onboard`
    - `GET /api/supplier/stripe/status`
  - Auth: `isAuthenticated`

- server/routes/suppliers/profileRoutes.ts _(extracted PR-11, PR-19)_
  - Paths:
    - `GET /api/supplier/me`
    - `PATCH /api/supplier/me`
    - `GET /api/suppliers/dashboard`
    - `GET /api/supplier/products`
    - `POST /api/supplier/products`
    - `PATCH /api/supplier/products/:productId`
    - `POST /api/supplier/products/import`
  - Auth: `isAuthenticated`

- server/routes/suppliers/ordersRoutes.ts _(extracted PR-7)_
  - Paths:
    - `POST /api/supplier-orders`
    - `GET /api/supplier/orders`
    - `GET /api/supplier-orders/mine`
    - `GET /api/supplier-orders/:orderId`
    - `PATCH /api/supplier/orders/:orderId/status`
  - Auth: `isAuthenticated`

- server/routes/suppliers/paymentsRoutes.ts _(extracted PR-7)_
  - Paths:
    - `POST /api/supplier-orders/:orderId/pay-intent`
  - Auth: `isAuthenticated`

- server/routes/suppliers/requestsRoutes.ts _(extracted PR-16, PR-17)_
  - Paths:
    - `POST /api/supplier-requests`
    - `GET /api/supplier-requests/mine`
    - `GET /api/supplier/requests`
    - `POST /api/supplier/requests/:requestId/accept`
    - `PATCH /api/supplier/requests/:requestId/delivery`
    - `POST /api/supplier-requests/import`
  - Auth: `isAuthenticated`

- server/routes/suppliers/supplyIntelRoutes.ts _(extracted PR-12)_
  - Paths:
    - `GET /api/supply/preferences`
    - `POST /api/supply/preferences`
    - `GET /api/supply/price-watches`
    - `POST /api/supply/price-watches`
    - `DELETE /api/supply/price-watches/:watchId`
    - `GET /api/supply/price-watches/alerts`
    - `GET /api/supply/price-watches/:watchId/history`
  - Auth: `isAuthenticated`

- server/routes/suppliers/shoppingListsRoutes.ts _(extracted PR-13)_
  - Paths:
    - `GET /api/supply/lists`
    - `POST /api/supply/lists`
    - `PATCH /api/supply/lists/:listId`
    - `DELETE /api/supply/lists/:listId`
    - `GET /api/supply/lists/:listId/items`
    - `POST /api/supply/lists/:listId/items`
    - `PATCH /api/supply/lists/:listId/items/:itemId`
    - `DELETE /api/supply/lists/:listId/items/:itemId`
  - Auth: `isAuthenticated`

- server/routes/suppliers/shoppingListOptimizeRoutes.ts _(extracted PR-14, PR-18)_
  - Paths:
    - `POST /api/supply/lists/:listId/optimize`
    - `POST /api/supply/order-list/import`
  - Auth: `isAuthenticated`

- server/routes/suppliers/searchDemandRoutes.ts _(extracted PR-15)_
  - Paths:
    - `GET /api/supply/search`
    - `POST /api/supply/demand`
  - Auth: `isAuthenticated`

- server/routes/suppliers/adminOrdersRoutes.ts _(extracted PR-20)_
  - Paths:
    - `GET /api/admin/supplier-orders`
  - Auth: `isAuthenticated` + `isAdmin`

- server/routes/suppliers/shared.ts
  - Supplier route dependency contract and shared utilities

## Other Mounted Route Modules
- server/incidentRoutes.ts
  - Mounted: `app.use('/api/incidents', incidentRoutes)`
  - Admin-only incident management APIs (guarded inside the router)

- server/affiliateRoutes.ts
  - Mounted: `app.use('/api/affiliate', affiliateRoutes)`

- server/payoutRoutes.ts
  - Mounted via default export function: payout preferences and payout-related APIs

- server/emptyCountyRoutes.ts
  - Mounted via default export function: empty-county experience routes (Phase 6)

- server/shareRoutes.ts
  - Mounted via default export function: share link routes (Phase 7)

- server/userRoutes.ts
  - Mounted: `app.use('/api/users', userRoutes)`

- server/redemptionRoutes.ts
  - Mounted: `app.use('/api/restaurants', redemptionRoutes)`

- server/storiesRoutes.ts
  - Mounted via default export function: story feed and story-related APIs

## Inline Endpoints (Still in server/routes.ts)
These are intentionally kept inline in the orchestrator for now:

- Bug reports:
  - `POST /api/bug-report`
- Deal feedback:
  - `POST /api/deals/:dealId/feedback`
  - `GET /api/deals/:dealId/feedback`
  - `GET /api/deals/:dealId/feedback/stats`
- Health / monitoring:
  - `HEAD /api`
  - `GET /api/health`
- Uploads:
  - `POST /api/upload/restaurant-logo`
  - `POST /api/upload/restaurant-cover`
  - `POST /api/upload/deal-image`
  - `POST /api/upload/user-profile`
  - `DELETE /api/upload/:imageId`
- Awards & ranking:
  - `GET /api/awards/*`
  - `GET /api/restaurants/:restaurantId/ranking-stats`

## Summary Table (Key Modules)

| Module                                              | Mount / Paths Prefix             | Auth                                | Notes                                          |
|-----------------------------------------------------|----------------------------------|-------------------------------------|------------------------------------------------|
| server/routes.ts                                    | (orchestrator)                   | n/a                                 | Wires middleware and route modules             |
| server/routes/hostRoutes.ts                         | /api/hosts*                      | isAuthenticated + host checks       | Delegator; subroutes below                     |
| server/routes/hosts/profileRoutes.ts                | /api/hosts (profile)             | isAuthenticated + host checks       | POST /api/hosts, GET /api/hosts/me (PR-4)      |
| server/routes/hosts/eventsRoutes.ts                 | /api/hosts/events*, interests*   | isAuthenticated + host checks       | Events and interests lifecycle (PR-5)          |
| server/routes/openCallSeriesRoutes.ts               | /api/hosts/event-series*         | isAuthenticated + host checks       | Open Calls series lifecycle                    |
| server/routes/eventRoutes.ts                        | /api/events*                     | isAuthenticated / isRestaurantOwner | Discovery + truck interest                     |
| server/routes/adminManagementRoutes.ts              | /api/auth/admin, /api/admin*     | isAuthenticated + isAdmin           | Residual admin orchestrator; subroutes below   |
| server/routes/admin/userAdminRoutes.ts              | /api/admin/users*                | isAuthenticated + isAdmin           | User management                                |
| server/routes/admin/adminCoreOpsRoutes.ts           | /api/admin/stats, /dashboard-totals | isAuthenticated + isAdmin        | Stats + core ops (PR-3)                        |
| server/routes/admin/dealsRoutes.ts                  | /api/admin/deals*                | isAuthenticated + isAdmin           | Deal admin CRUD (PR-1)                         |
| server/routes/admin/verificationRoutes.ts           | /api/admin/verifications*        | isAuthenticated + isAdmin           | Verification approve/reject (PR-2)             |
| server/routes/supplierMarketplaceRoutes.ts          | /api/supplier*, /api/supply*     | isAuthenticated                     | Residual orchestrator; subroutes below         |
| server/routes/suppliers/catalogRoutes.ts            | /api/suppliers*                  | isAuthenticated                     | Supplier browse/detail/products (PR-6)         |
| server/routes/suppliers/onboardingRoutes.ts         | /api/supplier (onboard/stripe)   | isAuthenticated                     | Supplier activation + Stripe (PR-11)           |
| server/routes/suppliers/profileRoutes.ts            | /api/supplier/me, /products*     | isAuthenticated                     | Self-management + products (PR-11, PR-19)      |
| server/routes/suppliers/ordersRoutes.ts             | /api/supplier-orders*            | isAuthenticated                     | Order CRUD + status (PR-7)                     |
| server/routes/suppliers/paymentsRoutes.ts           | /api/supplier-orders/pay-intent  | isAuthenticated                     | Payment intent flow (PR-7)                     |
| server/routes/suppliers/requestsRoutes.ts           | /api/supplier-requests*          | isAuthenticated                     | Request lifecycle + import (PR-16, PR-17)      |
| server/routes/suppliers/supplyIntelRoutes.ts        | /api/supply/preferences*, /price-watches* | isAuthenticated            | Preferences + price watch (PR-12)              |
| server/routes/suppliers/shoppingListsRoutes.ts      | /api/supply/lists*               | isAuthenticated                     | Shopping list CRUD (PR-13)                     |
| server/routes/suppliers/shoppingListOptimizeRoutes.ts | /api/supply/lists/optimize, /order-list/import | isAuthenticated  | Optimize + import (PR-14, PR-18)               |
| server/routes/suppliers/searchDemandRoutes.ts       | /api/supply/search, /demand      | isAuthenticated                     | Supply search + manual demand (PR-15)          |
| server/routes/suppliers/adminOrdersRoutes.ts        | /api/admin/supplier-orders       | isAuthenticated + isAdmin           | Admin order view (PR-20)                       |
| server/telemetryRoutes.ts                           | /api/admin/telemetry*            | isAdmin                             | Read-only telemetry                            |
| server/evidenceExportRoutes.ts                      | /api/admin/export-evidence*      | isAdmin                             | Evidence PDF export                            |
| server/adminRoutes.ts                               | /api/admin/*                     | isAdmin                             | Control center, moderation, lifetime           |

## Adding a New Route Module (Required Process)

1. Create a new module under `server/routes/`  
  - Export `registerXRoutes(app: Express)`
  - Do not register routes at import time.

2. Move handlers verbatim  
  - Preserve paths, middleware, status codes, and response messages.  
  - Do not change behavior during extraction.

3. Wire the module in `server/routes.ts`  
  - Import `registerXRoutes`  
  - Call it in the appropriate section, keeping existing ordering.

4. Verify no duplicate registrations  
  - Search for the route prefix across the repo (e.g. `/api/hosts`, `/api/events`).

5. Run the full gate before commit:

  ```bash
  npm run check
  npm run build
  npm run build:server
  npm run test:flows:with-server
  ```

No new route module is considered complete unless all of these gates pass.
