Status: `surface inventory evidence packet`

# MealScout Surface Inventory - 2026-06-19

## Purpose

First evidence-only output for the `Surface Inventory` lane.

This packet classifies the currently reachable MealScout route surface as `Green`, `Yellow`, `Red`, or `Unknown` from the current remote baseline:

- `main` SHA: `e221ed2a69e19e67d1f747f7b975a9371f5e16e9`

This is not a readiness claim.

It is a route-classification artifact so operators stop guessing which surfaces are safe to share.

## Evidence Basis

Inspected source:

- `client/src/App.tsx`
- `server/routes.ts`
- `MEALSCOUT_ROUTE_MAP.md`
- `MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md`
- `MEALSCOUT_AUTH_ONBOARDING_ALIGNMENT_AUDIT.md`
- `docs/ops/MEALSCOUT_LIVE_EXPOSURE_SURFACE_CONTAINMENT_AUDIT_2026-06-19.md`
- `docs/ops/MEALSCOUT_PARALLEL_READINESS_WORKSTREAMS_2026-06-19.md`
- `docs/ops/MEALSCOUT_PARALLEL_LANE_KICKOFF_PACKET_2026-06-19.md`
- `scripts/verifyRoutes.mjs`
- `scripts/smokeCriticalRoutes.mjs`
- `scripts/smokeScoutSurface.mjs`
- `scripts/mealscout-authenticated-production-smoke.ts`

Live proof used in this packet:

- `2026-06-19` production `/api/version` check returned merged main commit `e221ed2a69e19e67d1f747f7b975a9371f5e16e9`
- `2026-06-19` production admin request-log smoke passed:
  - unauthenticated `/api/admin/request-logs` -> `401`
  - authenticated no-param request -> `200`
  - authenticated valid `YYYY-MM-DD` request -> `200`
  - authenticated valid ISO request -> `200`
  - malformed explicit date -> controlled `400`
- `2026-06-19` `scripts/smokeCriticalRoutes.mjs` passed on production for:
  - `/`
  - `/login`
  - `/map`
  - `/api/health`
  - `/health/critical-endpoints`
  - `/api/auth/user`
  - `/api/hosts/me`
  - `/api/map/locations`
  - `/api/parking-pass`
  - guest admin guard behavior
- `2026-06-19` `scripts/smokeScoutSurface.mjs` passed on production for `/api/scout/surface`

## Classification Rules

- `Green`: live-proven or low-risk exact surface that is currently acceptable to share in the limited live posture
- `Yellow`: reachable and partly proven, but only acceptable with supervision or exact operator framing
- `Red`: reachable, but should not be intentionally shared in the current posture
- `Unknown`: reachable, but not evidenced enough in this packet to claim safe or unsafe beyond internal caution

Share-status labels:

- `allowed`
- `supervised`
- `do not share`
- `unresolved`

Evidence labels:

- `live-proven`: backed by live smoke or production check on `2026-06-19`
- `source-inferred`: backed by route and source inspection only
- `mixed`: some live proof exists, but the family still depends partly on source inspection

## Coverage Note

- `client/src/App.tsx` currently declares `144` unique frontend route patterns.
- This packet groups those route patterns into route families so every declared frontend route lands in one of the four classes.
- Backend route groups are mapped at the family level in this packet, not endpoint-by-endpoint.
- `Unknown` is intentional. It means "not yet proven," not "probably fine."

## Surface Matrix

| Route family | Included routes | Current promise | Evidence | Class | Share status | Why this class now |
| --- | --- | --- | --- | --- | --- | --- |
| Truck signup exact entry | `/restaurant-signup?businessType=food_truck` | Exact owner entry for truck-first onboarding | `live-proven` via containment audit and preserved production gate work; `source-inferred` from router | Green | allowed | This exact entry is the known-safe owner share URL. Legal gate and truck-first framing were already cleared and preserved. |
| Version and operator truth check | `/api/version` | Platform and deploy truth for operators | `live-proven` on `2026-06-19` | Green | allowed | This is the safest operator-visible runtime truth surface and is already used to verify production rollouts. |
| Smoked truck public-profile subset | Exact operator-shared truck profile URLs on `/p/:profileType/:profileId(/:profileSlug)`, `/truck/:slug`, or equivalent clean share path for the smoked trucks | Truthful public truck profile view with honest missing-state handling | `live-proven` from prior containment work plus preserved schedule truth; `mixed` because route family also depends on source inspection | Green | allowed | The smoked subset is the safest patron-facing profile set. |
| Root welcome shell | `/` | First-touch welcome or signed-in redirect into Scout | `mixed`: root route is `live-proven` in production critical smoke, but the shell is still interpreted through source inspection and containment docs | Yellow | supervised | The route loads and redirects correctly for signed-in users, but first-touch navigation still implies broader app breadth than the safe core. |
| Scout contained discovery family | `/scout`, `/scout/:refTag`, `/directory`, `/directory/:refTag`, `/scout-prototype`, `/food-truck-rush` | Early-access truck-first discovery | `live-proven` from production scout surface smoke; `mixed` with containment audit | Yellow | supervised | Discovery works and is live, but the surface still implies broader app breadth than the safest proven core. |
| Map discovery family | `/map` | Interactive nearby discovery and mapping | `live-proven` from production critical smoke; `mixed` with containment audit | Yellow | supervised | The route loads and current API health is good, but the map still exposes a wider product promise than the truck-first safe core. |
| General public truck-profile family outside the smoked subset | `/truck/:slug`, `/truck/:slug/:refTag`, `/p/:profileType/:profileId`, `/p/:profileType/:profileId/:profileSlug`, `/:businessSlug`, `/:businessSlug/:refTag`, truck-shaped uses of `/location/:slug`, `/location/:slug/:refTag`, `/location/:slug/food-trucks`, `/location/:slug/food-trucks-now`, `/location/:slug/food-trucks-tonight` | Public truck detail and truck-adjacent location discovery | `mixed` from source inspection plus prior public-profile hardening doctrine | Yellow | supervised | The public profile shell is truth-safer than before, but not every visible truck profile has been individually smoked. |
| Claim-truck owner entry | `/claim-truck`, `/claim-truck/:refTag` | Imported truck claim and owner continuation entry | `source-inferred` plus containment audit | Yellow | supervised | This is a valid operator-selected entry, but it is more stateful and context-sensitive than the exact truck-signup URL. |
| Auth entry and recovery family | `/login`, `/forgot-password`, `/reset-password`, `/change-password`, `/customer-signup`, `/customer-signup/:refTag`, `/ref/:tag` | Sign in, recover access, or start a user account path | `mixed`: `/login` is `live-proven`; the rest are `source-inferred` | Yellow | supervised | These routes are reachable and common, but this packet does not yet prove the full downstream state space for every branch. |
| Informational and policy family | `/terms-of-service`, `/moderation-policy`, `/privacy-policy`, `/data-deletion`, `/about`, `/compare`, `/compare/doordash`, `/compare/uber-eats`, `/compare/grubhub`, `/compare/:service/local/:city/:cuisine`, `/delivery-app-alternatives`, `/online-ordering-platforms`, `/faq`, `/how-it-works`, `/contact`, `/install`, `/sitemap`, `/status`, `/golden-plate-winners`, `/pensacola/spots`, `/pensacola/report` | Static or mostly static informational pages | `mixed`: `/status` and `/`-adjacent health are live-touched; most routes are `source-inferred` | Yellow | supervised | These pages are lower risk than transactional surfaces, but they still sit inside a shell whose global navigation can imply broader readiness. |
| Truck-first SEO and city landing family | `/food-trucks/:citySlug`, `/food-trucks/:citySlug/:cuisineSlug`, `/food-trucks-today/:city`, `/city/:city/food`, `/locations-with-trucks/:city` | Truck-oriented city or SEO landing entry | `source-inferred` plus containment audit | Yellow | supervised | These are truck-first and closer to current posture, but they still need more explicit live behavior sampling before being called broadly safe. |
| Broad mixed discovery and search family | `/search`, `/trending`, `/category/:category`, `/cuisine/:type`, `/cuisine/:cuisine/:city`, `/city/:city`, `/city/:city/:mode` | Broad cross-surface discovery | `source-inferred` plus containment audit | Red | do not share | These routes widen the product promise into broader discovery areas that are not yet separately proven. |
| Deal and event discovery family | `/deal/:id`, `/deals`, `/deals/featured`, `/deals/:city`, `/deals-today/:city`, `/events`, `/events/public`, `/event/:slug`, `/events-today/:city` | Public deals and event discovery | `source-inferred` plus containment audit | Red | do not share | Current limited live posture is truck-first. Deals and events remain outside the narrow proven share set. |
| Public restaurant and bar profile family | `/restaurant/:id`, `/restaurant/:id/:profileSlug`, `/bar/:slug`, `/bar/:slug/:refTag` | Public business detail for restaurant and bar surfaces | `source-inferred` plus containment audit | Red | do not share | The current live proof is truck-first, not restaurant-wide or bar-wide. These surfaces should not be promoted yet. |
| Direct transactional family | `/menu/:restaurantId`, `/checkout/:restaurantId`, `/order-confirmation/:orderId` | Public menu, checkout, and order completion | `source-inferred` plus containment audit | Red | do not share | These routes imply a broader transactional readiness than this posture currently supports. |
| Public supplier marketplace family | `/suppliers`, `/suppliers/:supplierId`, `/supplier/:slug`, `/supplier/:slug/:refTag` | Supplier browse and supplier public profile detail | `source-inferred` | Red | do not share | Supplier surfaces are reachable but outside the current truck-first limited exposure doctrine. |
| Public content and recruiting family | `/video`, `/video/:id`, `/hiring`, `/jobs`, `/private-chefs` | Public content, recruiting, or adjacent promotional surface | `source-inferred` | Red | do not share | These routes are reachable, but they are outside the current narrow live truck-first operating promise and should not be treated as readiness proof. |
| Public operator-adjacent and off-scope promotion family | `/parking-pass`, `/share-hub`, `/deal-creation`, `/admin`, `/admin/login`, `/host-signup`, `/scoutcoin` | Public entry to operational, off-scope, or non-core product areas | `mixed`: route health is live-touched for `/parking-pass` and guest admin rejection, but the family is mostly `source-inferred` | Red | do not share | These routes either belong to a different product lane or create false readiness signals for general users. |
| Stateful continuation and invite family | `/account-setup`, `/owner/verify`, `/post-verification`, `/business-team/accept` | Continue a tokenized or stateful flow after a prior step | `source-inferred` plus containment audit | Red | do not share | These routes are valid continuation surfaces, not safe cold-entry destinations. |
| Owner interior operations family | `/dashboard`, `/restaurant-owner-dashboard`, `/restaurant/dashboard`, `/deal-edit/:dealId`, `/subscribe`, `/truck-discovery`, `/business-team`, `/menu-builder`, `/kitchen` | Logged-in owner continuation, dashboard, or edit surfaces | `source-inferred` | Unknown | unresolved | Reachable and clearly important, but this packet does not yet prove current state behavior across owner states. This belongs to the owner-journey hardening lane next. |
| Customer interior account family | `/user-dashboard`, `/favorites`, `/orders`, `/profile`, `/profile/notifications`, `/profile/settings`, `/settings`, `/profile/addresses`, `/profile/payment`, `/profile/help`, `/profile/reporter-reputation`, `/restaurant/:restaurantId/reviews` | Logged-in customer account and customer-owned interior routes | `source-inferred` | Unknown | unresolved | These surfaces are reachable but were not live-smoked in this packet and are not part of the current narrow sharing doctrine. |
| Host, coordinator, and supplier interior family | `/host/dashboard`, `/event-coordinator/dashboard`, `/supplier/dashboard`, `/supply/orders`, `/affiliate/earnings`, `/parking-pass-manage` | Authenticated host, event, supplier, or management continuation surfaces | `source-inferred` | Unknown | unresolved | Internal and role-sensitive. This packet does not yet provide enough stateful proof to classify them safer or riskier than internal caution. |
| Admin and staff interior family | `/staff`, `/admin/dashboard`, `/admin/incidents`, `/admin/control-center`, `/admin/giveaway-wheel`, `/admin/tickets`, `/admin/moderation`, `/admin/moderation/queue`, `/admin/moderation/videos`, `/admin/moderation/metrics`, `/admin/moderation/appeals`, `/admin/audit-logs`, `/admin/vac-logs`, `/admin/telemetry`, `/admin/geo-ads`, `/admin/geo/heatmap`, `/admin/affiliates`, `/admin/switcher`, `/admin/oauth-setup` | Staff or admin operational surfaces | `mixed`: `/api/admin/request-logs` and guest admin guard are `live-proven`; most route interiors remain `source-inferred` | Unknown | unresolved | Operator visibility has improved, but this packet does not separately classify each admin interior as ready or unsafe. They remain internal surfaces pending a dedicated admin inventory pass. |

## Backend Family Alignment

These backend route groups back the frontend surface classes above:

- `Green` and `Yellow` public truck-first surfaces primarily map to:
  - `registerScoutSurfaceRoutes`
  - `registerPublicDiscoveryRoutes`
  - `registerPublicMapRoutes`
  - `registerPublicSeoLandingRoutes`
  - `registerRestaurantCoreRoutes`
- `Red` public broad-discovery and transactional surfaces primarily map to:
  - `registerPublicSearchRoutes`
  - `registerDealDiscoveryRoutes`
  - `registerEventRoutes`
  - `registerMenuRoutes`
  - `registerPickupOrderRoutes`
  - `registerSupplierMarketplaceRoutes`
- `Unknown` authenticated interior surfaces primarily map to:
  - `registerRestaurantOperationsRoutes`
  - `registerBusinessTeamRoutes`
  - `registerSubscriptionRoutes`
  - `registerHostRoutes`
  - `registerBookingRoutes`
  - `registerAdminManagementRoutes`
  - `registerGeoAdRoutes`
  - `registerGrowthRoutes`
  - `registerStaffRoutes`

This packet does not classify every backend endpoint individually.

That follow-up is still open.

## Coverage Check

This packet accounts for every currently declared frontend route pattern in `client/src/App.tsx` by family, including:

- guest and mixed discovery routes
- public profile aliases
- public SEO and city routes
- public transactional routes
- public operator-adjacent routes
- continuation routes
- authenticated owner routes
- authenticated customer routes
- authenticated host and supplier routes
- authenticated admin and staff routes

No declared frontend route pattern is intentionally left outside the matrix.

## What Is Proven

- The current safest share set is still narrow:
  - exact truck-signup entry
  - exact smoked truck-profile links
  - contained Scout and Map use under supervision
- Operator visibility improved materially:
  - `/api/version` is truthful
  - admin request-log retrieval is live and fixed
  - request-log insertion still works
- Scout surface payloads and critical public route health are currently live on production

## What Is Still Unproven

- Full owner continuation behavior across all owner dashboard states
- Customer interior account-state quality
- Host, supplier, and coordinator interior flows
- Admin interior readiness beyond the repaired log-viewer path and guest guard behavior
- Broad restaurant, deals, events, supplier, and transactional surface readiness

## Blocker Readout For This Lane

Current surface-inventory blockers still visible from this packet:

- many intentionally reachable surfaces remain `Red` or `Unknown`
- broad public exploration still overstates real app readiness if users roam freely
- authenticated interior families still need separate evidence before they can move out of `Unknown`

## Next Decision Gate

Do not treat this packet as proof that the app is ready.

Use it to:

- share only `Green` routes directly
- supervise `Yellow` routes
- stop intentionally sharing `Red` routes
- queue follow-up evidence passes for the `Unknown` interior families

The next narrow inventory step should be:

- `Surface Inventory Follow-Up: Authenticated Interior States`

That follow-up should classify the current `Unknown` families by role:

- owner
- customer
- host
- supplier
- admin
- staff

## Scope Confirmation

- No runtime code changed in this packet.
- No schema changed in this packet.
- No production data changed in this packet.
- No cleared blocker was reopened without live regression evidence.
