# MealScout Live Exposure Surface Containment Audit — 2026-06-19

Status: `P1 live-operator containment audit`

## Decision

MealScout is **not** ready for broad app-wide launch.

MealScout is acceptable only as a **controlled live exposure** around its safest verified surfaces:

- exact food-truck signup entry
- a narrow set of truthful public truck profiles
- limited truck discovery surfaces with operator supervision
- telemetry and request logging that let operators see harm quickly

This is a containment posture, not a scale-up posture.

## Evidence Basis

Inspected source and recent repo evidence:

- `client/src/App.tsx`
- `client/src/pages/scout-prototype.tsx`
- `client/src/pages/map.tsx`
- `client/src/pages/search.tsx`
- `client/src/pages/public-profile.tsx`
- `client/src/pages/restaurant-signup.tsx`
- `client/src/pages/claim-truck.tsx`
- `client/src/pages/online-menu.tsx`
- `client/src/pages/pickup-checkout.tsx`
- `client/src/pages/event-detail.tsx`
- `client/src/components/navigation.tsx`
- `client/src/components/public-profile/truckScheduleTruth.ts`
- `client/src/hooks/useDiscoverableTrucks.ts`
- `server/routes/publicDiscoveryRoutes.ts`
- `server/routes/publicMapRoutes.ts`
- `server/routes/publicSearchRoutes.ts`
- `server/routes/restaurantCoreRoutes.ts`
- `server/routes/restaurantOperationsRoutes.ts`
- `server/routes/truckClaimRoutes.ts`
- `server/routes/analyticsRoutes.ts`
- `MEALSCOUT_ROUTE_MAP.md`
- `MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md`
- `MEALSCOUT_AUTH_ONBOARDING_ALIGNMENT_AUDIT.md`
- `docs/MEALSCOUT_LAUNCH_SURFACE_AUDIT.md`
- `docs/qa/MEALSCOUT_SOFT_LAUNCH_READINESS_STATUS_2026-06-18.md`
- `docs/qa/MEALSCOUT_FOUR_DAY_HARDENING_SUMMARY_2026-06-18.md`

Known cleared blockers preserved in this audit:

- food-truck signup legal gate
- public truck schedule-state contradiction
- `/api/version` production truth
- bot/prerender public profile routing

## Surface Summary

### Green Surfaces

- `/restaurant-signup?businessType=food_truck`
- `/api/version`
- repaired bot/prerender public truck profile intake routing
- the schedule-smoked truck profile subset that truthfully renders `No schedule posted`:
  - `3D Eats & Tea`
  - `Sweet Love`
  - `All Gas No Brakes Reloaded`
  - `CREATIVBOWLS`
  - `Jays Southern Cuisine`

### Yellow Surfaces

- `/scout`
- `/map`
- `/claim-truck`
- `/api/trucks/live`
- public truck profiles outside the smoked subset, when they keep honest incomplete states
- public-profile embedded menu and schedule sections when they render truthful missing-state copy
- safe public-profile CTAs filtered through `cta.safe`

### Red Surfaces

- direct routing to `/account-setup`, `/owner/verify`, `/post-verification`
- public restaurant profiles as an intentionally promoted surface
- `/search` as a promoted user destination in the current containment posture
- direct promotion of `/menu/:restaurantId`, `/checkout/:restaurantId`, `/order-confirmation/:orderId`
- Scout routes that push people into deals, events, or broad discovery claims
- guest/public navigation that promotes `/video`, `/events`, `/share-hub`, `/parking-pass`, `/suppliers`, `/deal-creation`, or `/admin`
- any operator/admin-oriented shell a guest can reach but should not be sent to intentionally

## Detailed Surface Map

| Surface | Current user promise | Actual current behavior | Trust risk | Content completeness risk | Legal/compliance risk | Data capture visibility | Class | Recommended action | Action type |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/restaurant-signup?businessType=food_truck` | Create a free truck profile and start owner onboarding | Public shell exposes Terms and Privacy, blocks unchecked terms, supports claim handoff; downstream setup still branches into verification and owner continuation | Low on entry shell | Low | Low; legal gate is enforced client and server side | High: request logs, funnel telemetry, signup/auth routes | GREEN | Share only this exact food-truck entry URL to owners; do not deep-link cold traffic into later setup routes | operator |
| `/claim-truck` | Find an imported truck and claim or request setup | Public search works, cooldown and no-email states are honest, claim action routes into authenticated signup/claim continuation | Medium | Low | Low | Moderate: request logs and claim-request events | YELLOW | Use only for owners who already know why they are here; operator should choose between direct signup and claim flow | operator |
| `/account-setup`, `/owner/verify`, `/post-verification` | Continue account setup or verification | Safe continuation routes exist, but these are tokenized or stateful continuation surfaces, not public destinations | High if cold traffic is sent here | Low | Medium if users are confused into broken handoff states | Moderate | RED | Never intentionally share these routes except for tokenized invite or verification continuations | operator |
| `/scout` | Broad local discovery of trucks, restaurants, deals, and events | Real truck discovery works, but scene tiles and feed cards widen into restaurants, deals, events, and search-based exploration | Medium to High | High | Low | Moderate; request logs confirmed, route-specific card analytics not clearly confirmed in inspected scope | YELLOW | Keep live, but only route controlled users here; do not market it as complete discovery coverage | operator + copy |
| Scout truck cards -> public truck profiles | See a truck that is safe enough to inspect | Cards route to public truck profiles using clean public paths | Medium outside smoked set | Medium | Low | High on profile pages via profile analytics and quality signals | YELLOW | Allow only for individually trusted or smoked truck profiles; operator-shared links should favor the smoked subset | operator |
| Scout restaurant cards -> public restaurant profiles | See comparable restaurant detail pages | Route exists and shares the same public profile shell, but the current hardening work is truck-first, not restaurant-wide | High | High | Low | Moderate | RED | Do not intentionally route users from Scout into restaurant profiles yet | code + operator |
| Scout deal cards -> `/search?q=deals` | Continue browsing relevant food offers | Sends users into the broader search surface, not a contained truck-first lane | High | High | Low | Moderate | RED | De-emphasize or stop intentionally routing users into deal-search from Scout during containment | code |
| Scout event cards -> `/event/:id` | Open event detail | Event detail route can resolve id/slug, but this is outside the current safe truck-first exposure set | Medium to High | Medium | Low | Moderate | RED | Do not intentionally route patrons into events from Scout in this phase | code + operator |
| `/map` | Interactive local food map with nearby activity | Works, but includes trucks, events, suppliers, Parking Pass hosts, truck sighting submission, and “truck not here” reporting flows | Medium to High | High | Low | High: request logs plus map reporting endpoints and geo/UX telemetry hooks | YELLOW | Only share when current behavior is acceptable for the target user; do not promote as a complete local-food control surface | operator + copy |
| `/api/trucks/live` | Current nearby live/discoverable trucks | Requires `lat` and `lng`; returns trusted nearby payload, but should not be treated as exhaustive city truth | Medium if over-claimed | Medium | Low | Moderate; request logs confirmed | YELLOW | Treat as a backing feed, not a public completeness promise | operator |
| Public truck profiles, smoked subset | Truthful truck detail with honest schedule/menu states | Five known profiles already passed live schedule-truth smoke; public profile shell filters to safe CTAs and honest empty states | Low | Medium | Low | High: `/api/public/profile-analytics`, `/api/analytics/shell`, request logs | GREEN | Share these profiles directly as the safest live patron destinations | operator |
| Public truck profiles, general population | Truthful truck detail pages | Missing menu and schedule states are honest, but many profiles remain sparse and not every profile has been individually smoked | Medium | High | Low | High | YELLOW | Share selectively; do not imply completeness across all trucks | operator + data |
| Public restaurant profiles | Truthful restaurant detail pages | Same profile shell works, but the current live proof and content doctrine center on trucks; ordering/menu/deal expectations are broader | High | High | Low | High | RED | Do not intentionally route real users here until a separate restaurant readiness pass exists | operator |
| Public-profile menu section | See available menu evidence without being misled | Renders `Partial menu from available source...`, `Menu unavailable right now.`, or `Menu: none found.` instead of inventing completeness | Medium | Medium | Low | High via profile quality signals | YELLOW | Keep honest incomplete states; do not oversell menu completeness in surrounding copy | copy |
| Direct menu route `/menu/:restaurantId` | Browse a full online menu and potentially order | Public menu page explicitly supports cart, fees, checkout handoff, and ordering-readiness logic | High | High | Medium because users can infer ordering is broadly ready | Moderate | RED | Do not intentionally route cold traffic here until ordering surfaces are separately certified | operator + code |
| Direct checkout/order routes `/checkout/:restaurantId`, `/order-confirmation/:orderId` | Complete pickup checkout | Public checkout touches ordering readiness, payment browser gates, Stripe/cash flows, and subscription-dependent failure states | High | Medium | Medium | Moderate | RED | Keep reachable only as a downstream flow from already-valid ordering paths; do not promote | operator |
| Truck schedule display inside public profiles | See truthful current/upcoming truck schedule | `No schedule posted` is preserved when there are no actionable rows; schedule badge only renders when actionable schedule exists | Low on smoked set, Medium elsewhere | Medium | Low | High via quality signals | YELLOW | Treat the smoked subset as green; keep general truck schedule surfaces in supervised exposure only | operator |
| `/search` and no-results behavior | Unified search across trucks, restaurants, deals, events, parking, video, and menu items | Empty state is honest and helpful, but the surface routes people into many off-containment areas and broader product promises | Medium to High | High | Low | Moderate | RED | Do not intentionally send users here during containment; keep as incidental overflow only | operator + code |
| Header/footer/nav links on public and guest surfaces | Help people move around the app | Guest/global nav pushes `/video`, `/events`, `/customer-signup`, `/share-hub`, `/parking-pass`, and more-menu routes; public profile header/footer point to `/scout` and `/claim-truck` | High because chrome implies broader readiness | High | Low | Low to Moderate | RED | For containment, share exact safe URLs instead of letting first-touch users free-roam through navigation | operator + code |
| Public profile CTAs | Quick safe actions like menu, map, phone, order, or social links | Public profile shell filters to `cta.safe` items and prioritizes menu/map/order/phone, but the destination truth still depends on the profile’s actual completeness | Medium | Medium | Low | High | YELLOW | Allow only verified safe CTAs; do not add unsupported booking/order/menu promises | code + data |
| Publicly reachable operator/admin-adjacent shells | Advanced creation or admin access | Guest router still exposes public entries like `/deal-creation` and `/admin`; some actions will fail closed, but these are not containment destinations | High | Low | Low to Medium | Moderate | RED | Do not intentionally route real users here; future narrow fix should hide or de-emphasize these entries from guest discovery paths | code |

## Immediate Containment Actions

1. Route patrons only to:
   - `/scout`
   - the smoked truck-profile subset
   - `/map` only when the current multi-surface behavior is acceptable for the intended audience
2. Route owners/operators only to:
   - `/restaurant-signup?businessType=food_truck`
   - `/claim-truck` when an imported listing is known or likely
3. Stop sharing direct links to:
   - `/search`
   - public restaurant profiles
   - `/menu/:restaurantId`
   - `/checkout/:restaurantId`
   - `/account-setup`
   - `/owner/verify`
   - `/post-verification`
4. Treat guest/public navigation as non-authoritative for containment.
   Safe sharing should use exact URLs, not “go browse the app.”
5. De-emphasize Scout routes that branch into deals and events before sending more real users there.
6. Keep honest incomplete-state text exactly as-is on truck profiles.
   Do not replace missing menu or schedule truth with optimistic copy.
7. Keep public-profile CTA safety strict.
   Menu, map, phone, and share are acceptable only when the destination is verified and non-misleading.

## Top 5 User-Trust Risks

1. `/scout` currently feels broader than the safe product core.
   The surface presents trucks, restaurants, deals, and events even though the safest proven live lane is still truck-first.
2. `/map` exposes too many product promises at once.
   Trucks, events, suppliers, Parking Pass hosts, and crowd-report/report-missing flows create a wider promise surface than containment wants.
3. Public navigation chrome implies the full app is ready.
   Guest and public-profile navigation still points people toward `/video`, `/events`, `/share-hub`, `/parking-pass`, and other off-scope routes.
4. Public restaurant and direct ordering routes can overstate readiness.
   Restaurant profiles, `/menu/:restaurantId`, and checkout flows imply a more mature and complete transactional product than this lane supports.
5. Sparse but truthful truck profiles can still feel empty.
   Even when the app is honest, repeated exposure to thin profiles can make MealScout feel unfinished or low-trust if operators share the wrong links.

## Recommended Next Implementation Lane

`P1 Exposure Guardrails Narrow Slice`

Scope:

- hide or de-emphasize guest/public links into red surfaces
- reduce Scout-to-deals and Scout-to-events routing pressure
- add light early-access wording on yellow surfaces where the breadth of the product is implied
- publish an operator-safe link packet for exactly what to share with patrons and owners

Do not do in this lane:

- rebuild Scout
- redesign the whole app
- change schema
- invent content
- reopen cleared signup/schedule/version blockers without fresh live regression evidence

## Final Containment Call

MealScout is live in limited form.

The safest public exposure today is:

- exact food-truck signup entry
- selected truthful truck profiles
- narrow supervised discovery

The unsafe move is broad navigation-driven exploration that implies all discovery, restaurant, menu, event, ordering, and owner-continuation surfaces are equally ready.

## Scope Confirmation

- No runtime code changed in this audit.
- No schema changed in this audit.
- No production data changed in this audit.
- Cleared blockers were not reopened without new regression evidence.
