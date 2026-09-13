# MealScout Canonical UI/UX Architecture Decision Packet

Status: Proposed for approval
Date: 2026-07-16
Scope: UI/UX architecture only. No implementation authorization.

## Executive decision

MealScout should become one everyday food-discovery product with two related shells:

1. A consumer shell centered on **Scout**.
2. A business workspace centered on the operator's **business identity**.

Scout remains the canonical discovery surface. Search, map, categories, recommendations, deals, events, and live food-truck status are discovery modes and result types inside or adjacent to Scout—not competing applications. Public profiles, menus, event details, and deal details are decision surfaces reached from Scout and must return naturally to the same discovery context.

The business side should use one workspace shell with capability-based modules. Restaurants, bars, food trucks, caterers, and private chefs share identity, menu/offerings, media, promotions, audience, team, payments, and settings patterns where the current data supports them. Hours, truck schedules, host event series, supplier catalogs, and event-coordinator workflows remain distinct modules because their underlying jobs differ.

No route should be removed in the first implementation slice. Legacy retirement requires confirmed replacement, runtime-reference verification, redirects where appropriate, and passing route/contract tests.

---

## 1. Confirmed architecture facts

### Routing and shells

- `client/src/App.tsx` currently declares approximately 130 unique route/component combinations across public and authenticated branches.
- `/scout`, `/scout/:refTag`, `/scout-v2`, `/directory`, and `/directory/:refTag` resolve to `ScoutPageV2` in `explore-preview-v2.tsx`.
- Signed-in `/` redirects to Scout; signed-out `/` renders Welcome.
- `/map` and `/trending` already redirect to Scout.
- Public restaurant, truck, bar, location, supplier, generic profile, and clean-slug routes converge on `PublicProfilePage` or `CleanPublicProfileRoute`.
- The retired `explore-preview.tsx` implementation has been removed. Contract tests now inspect the canonical `explore-preview-v2.tsx` owner.
- `/truck-discovery` is routed and has active inbound links from the dashboard switcher, events router, and Pensacola spots surface. It is not orphaned.
- `/food-truck-rush`, `/golden-plate-winners`, and `/scout-prototype` are routed but have no inbound references in `client/src` outside their route declarations and own files. That makes them confirmed **unlinked routes**, not automatically safe to delete.
- `/pensacola/report` and `/pensacola/spots` cross-link and are campaign/lead-generation surfaces. Absence from primary navigation does not prove they are unused externally.

### Current navigation

- One `Navigation` component serves both mobile and desktop.
- Both breakpoints use the same role-resolved six-slot model; desktop renders a floating top control and mobile renders a fixed bottom bar.
- Every lane begins with Scout and ends with More.
- Current lanes are resolved in this precedence: guest, admin/staff, event coordinator, supplier, food truck, restaurant/team member, host, customer.
- Current primary slots are:

| Persona | Served primary destinations |
|---|---|
| Guest diner | Scout, Truck signup, Login, Claim, More |
| Signed-in diner | Scout, Video, Events, Saved, Share, More |
| Food-truck owner | Scout, Parking Pass, Orders, Kitchen, Share, More; onboarding replaces the middle slots with setup/claim links |
| Restaurant owner | Scout, Orders or Parking Pass, Kitchen, Dashboard, Share, More; onboarding replaces these with setup/claim/finish |
| Host | Scout, Parking Pass, Video, Dashboard, Share, More |
| Event coordinator | Scout, Events, Requests, Dashboard, Share, More |
| Supplier | Scout, Orders, Products, Dashboard, Share, More |

- The More sheet exposes additional persona-specific tools, including profile access, reports, suppliers, events, host venue, and administrative destinations.
- This is a confirmed IA problem: consumer media and business operations compete at the same global-navigation level, and operator tools are distributed between primary slots, More, `/dashboard`, and persona-specific dashboard routes.

### Consumer surfaces

- `explore-preview-v2.tsx` is the canonical but overloaded Scout implementation and owns search mode, location context, map/list scenes, recommendations, deals, events, restaurant/truck cards, favorites/follows, and telemetry.
- `/search` remains a separate search product with its own filters and persisted discovery radius.
- Scout and Search both persist a discovery-radius value under `mealscout:discovery-radius-km`, but they implement location/search behavior separately rather than through one UI/state service.
- Scout has separate business-card image and entity-normalization logic; public profile has its own hero and CTA policy.
- Favorites and the diner dashboard overlap in saved/claimed content.
- Online menu to checkout uses a local browser cart. This is current behavior and must not be changed as part of UI architecture work.
- City, cuisine, location, deals-today, events-today, and food-trucks-today routes provide indexable acquisition paths that overlap with discovery but have a legitimate SEO entry role.

### Business surfaces

- `RestaurantOwnerDashboard` is the main restaurant/food-truck management surface and contains profile, hours, truck status/schedule, media, analytics, deals, and other tools.
- `MenuBuilderPage` owns menu/category/item management.
- `HostDashboard`, `SupplierDashboardPage`, and `EventCoordinatorDashboard` operate on genuinely different entities and workflows.
- `ProfileSetupPage` is a static marketing/information page, not an editor or onboarding wizard.
- Restaurant signup and Claim Business both touch the truck/business claim workflow.
- Gallery management exists in both owner management and generic profile settings.
- Host signup uses a different form-state/validation approach than other signup flows.
- `/api/owner/menus` and `/api/menus` are not confirmed legacy duplication. They serve different owner-list/create and shared menu-content responsibilities in the same route module.

### Entity consistency

- `shared/businessTypes.ts` currently defines canonical food-business types: restaurant, bar, food truck, caterer, and private chef.
- The same module defines explicit capability flags for recurring hours, dated stops, live location, menus, ordering, booking, events, supplier catalogs, and host locations.
- Scout uses shared business-kind normalization and shared public-profile path construction for restaurant-, truck-, bar-, and menu-item-owned entities.
- Food-truck presence is not a single boolean. Scout derives live broadcast state from broadcasting flags, current coordinates, timestamps, expiry, source, and freshness; serving-now can also come from explicit service fields or schedules.
- Public profile separately consumes `truckPresence.broadcastState` and truck schedule rows. The concepts align, but presentation labels differ: “Live now,” “Serving now,” “Scheduled,” “Scheduled here now,” “Open today,” and “Next scheduled.”
- Restaurants use recurring operating hours. Trucks may use recurring hours, dated schedule stops, current live coordinates, and broadcast freshness. Hosts use event series. Event coordinators use event/request records. These should share display grammar, not one storage/editor model.
- Scout business imagery is resolved through shared media selection for the `scout_card` context. Public profiles use a separate hero-assets builder. Owner uploads write logo, cover, and gallery media through existing media routes.
- CTA ranking is centralized for public-profile CTA collections, but Scout cards, profile hero/decision areas, and truck visit summaries still compose and label actions independently.

### Current state surfaces

The live product includes these recurring state families:

- Loading: route lazy loading, query-specific spinners/skeletons, Scout loading scenes.
- Empty: Scout-specific empty state, collection-specific empty lists, missing menu, missing schedule, no gallery, no favorites, no orders.
- Error: map error boundary, profile error boundary, query-local errors, form/server errors.
- Degraded: location denied/unavailable, map runtime unavailable, stale truck broadcast, unclaimed/thin profile, missing hours/schedule, unavailable item, missing payment configuration.
- Modal/drawer/sheet patterns: More navigation sheet, Scout search/filter/map panels, map preview sheet, restaurant deals drawer, deal claim/share modals, event/parking payment modals, upload/import dialogs, schedule dialogs, onboarding steps, and CRUD confirmation dialogs.

---

## 2. Unresolved questions

These are stop conditions for destructive or behavior-changing work, not blockers to the first visual-shell slice:

1. External traffic and conversion data for unlinked routes (`/food-truck-rush`, `/golden-plate-winners`, `/scout-prototype`) is not established.
2. External campaign dependencies for Pensacola, comparison, and marketing routes are not established.
3. The exact canonical clean-slug policy and collision behavior for `/:businessSlug` needs runtime/API confirmation before changing profile aliases.
4. Whether “follow” and “favorite” are intentionally different user concepts or should be presented as one Saved model needs product confirmation from existing mutations/analytics.
5. Ordering availability by business type must remain based on existing API capability and payment setup; the UI cannot infer universal ordering from the capability table alone.
6. Caterer and private-chef public profile completeness and owner-management coverage require task-level acceptance testing before their workspace modules are exposed.
7. Supplier and host public profiles use the shared renderer but do not have identical menu/location semantics; their target templates require entity-specific content audits during their implementation phase.
8. Administrative and staff surfaces are inventoried for route disposition but are outside the first consumer/business visual rebuild. Their visual-token adoption should be a separate controlled decision.

---

## 3. Canonical MealScout product model

### Product hierarchy

```text
MealScout
├── Discover (consumer shell)
│   ├── Scout: intent + location + filters + results + map
│   ├── Saved: favorited/followed entities and saved decision objects
│   ├── Activity: relevant deal, event, order, and account outcomes
│   └── Account
├── Decide (contextual consumer surfaces)
│   ├── Public business profile
│   ├── Menu / offerings
│   ├── Deal detail
│   ├── Event detail
│   └── Ordering / checkout
├── Acquire (indexable entry surfaces)
│   ├── City / cuisine / location landing pages
│   ├── Comparison and educational pages
│   └── Campaign pages
└── Operate (business workspace)
    ├── Business identity switcher
    ├── Capability-based modules
    ├── Persona-specific operational modules
    └── Operator account / team / payments / settings
```

### Canonical entities

| Entity | Identity | Discovery truth | Availability truth | Offering truth | Primary operator job |
|---|---|---|---|---|---|
| Restaurant | Food business | Location, cuisine, images, reputation | Recurring hours/open status | Menu/items, deals, ordering where configured | Keep profile, hours, menu, media, orders current |
| Bar | Food business | Location, drinks/food context, events | Recurring hours/open status | Menu/offerings, deals, events | Same shared workspace with bar terminology |
| Food truck | Mobile food business | Current/next location, food, live freshness | Live broadcast + dated stops + schedule | Menu/items, deals, ordering where configured | Publish schedule, go live, manage menu and bookings |
| Caterer | Service food business | Service area, cuisine, portfolio | Booking/availability information where supported | Packages/menu/offerings | Present services and manage requests |
| Private chef | Service provider | Service area, cuisine, portfolio | Booking/availability information where supported | Offerings | Present services and manage leads/bookings |
| Host/location | Venue | Location, amenities, hosted activity | Event series and available hosting windows | Parking/hosting opportunities | Publish opportunities and manage bookings/events |
| Supplier | Marketplace business | Service area and catalog relevance | Fulfillment/operating information | Products/catalog | Manage products, requests, and orders |
| Event | Time-bound discovery object | Place, date, participants | Start/end/capacity/status | Tickets/booking where supported | Publish and manage interest/requests |
| Deal | Time-bound decision object | Business, value, validity | Active/expired/claimed | Offer terms | Create, edit, measure, fulfill |

### Canonical status language

Use four user-facing availability families:

1. **Open now / Closed / Opens at…** for recurring-location businesses.
2. **Live now / Scheduled today / Next stop… / Schedule not posted** for trucks.
3. **Available by request / Next availability… / Availability not posted** for service providers where supported.
4. **Upcoming / Happening now / Ended / Sold out or unavailable** for events.

“Live” must only describe a fresh truck broadcast or an event currently in progress. “Serving now” may describe a schedule-derived truck state, but must not visually impersonate a verified live broadcast.

---

## 4. Consumer information architecture and workflows

### Surface responsibilities

| Surface | Classification | Exact responsibility | Relationship to Scout |
|---|---|---|---|
| Welcome | Marketing/entry route | Lightweight signed-out entry, value cue, sign in/create account, Scout | Sends users directly into the scouting flow; no application hero after entry |
| Scout | Primary surface | Interpret food intent, location, time, filters; show mixed relevant results with synchronized map/list | Canonical discovery home |
| Search | Supporting surface, then merge target | Focused full-results mode for explicit text/category queries | Becomes a Scout search state; old URL remains a compatible entry |
| Public profile | Decision surface | Answer “should I choose this place/provider now?” with food, availability, location, menu, proof, and actions | Preserves back-to-results/map context and offers related Scout discovery |
| Deals | Supporting collection/detail | Browse active offers and understand/claim/share one offer | Deals are a Scout filter/result type; dedicated URLs remain shareable |
| Events | Supporting collection/detail | Browse upcoming food-related events and act on one | Events are a Scout filter/result type; dedicated URLs remain shareable |
| Favorites/Saved | Primary account collection | Return to chosen businesses, deals, events, or followed content supported by current data | Saved state is visible in Scout and profiles |
| Menu | Decision/detail surface | Browse categories/items/prices/availability and begin order where supported | Entered from profile or Scout item; returns to owning profile/context |
| Ordering/checkout | Transaction flow | Cart, fulfillment/payment, confirmation | Separate focused flow; no IA redesign of payment behavior |
| User account | Account utility | Identity, notifications, addresses, payment methods, support, privacy/settings | Outside discovery hierarchy but reachable consistently |
| Video | Supporting media collection | Browse existing food stories/video and open related entities | Discovery content, not a primary global destination |
| City/cuisine/location pages | Marketing/SEO routes | Indexable landing with useful local results | “Scout” carries query/location context into canonical discovery |

### Definitive diner workflow

```text
Open MealScout
  → Scout obtains or asks for location context
  → user expresses intent (dish, cuisine, place, truck, event, time)
  → results and map update as one selection model
  → user previews a result
  → opens public profile
  → checks food/menu + availability + location + proof
  → saves/shares/follows OR takes primary action
  → returns to the same Scout query/map position
```

### Scout interaction model

- Mobile default: compact intent field, location chip, horizontally scrollable high-value filters, result list, and a persistent Map/List switch.
- Map and list share one result set, selection, filters, sort, and viewport state.
- Selecting a map marker opens the same result preview used in list mode; it does not launch a second discovery product.
- Desktop: split list/map when space allows, with the same intent/filter header and a profile/detail route opening normally.
- Mixed results are grouped only when grouping helps a decision: Best matches, Serving/Open now, Food trucks nearby, Dishes, Deals, Events. No decorative rails without a decision purpose.
- Search suggestions may include dishes, cuisines, businesses, trucks, and events, but Scout is never framed as a chatbot and does not use conversational assistant language.

### Consumer state rules

| State | Required response |
|---|---|
| Initial loading | Preserve shell and filter geometry; show food-result skeletons and map placeholder |
| Location pending | Let the user search a city/address immediately; explain browser permission only at the location control |
| Location denied | Use chosen/recent city; show “Use current location” as a recoverable action |
| No exact results | Keep intent visible, loosen one constraint transparently, and offer nearby alternatives |
| Map unavailable | Keep list fully usable and state that map view is unavailable |
| Partial API failure | Render successful result families; label the unavailable section and allow retry |
| Stale truck broadcast | Never label live; show last known/scheduled context if valid |
| Missing menu/hours/schedule | Explicit missing-information state with an appropriate next action, not an empty card |
| Auth required | Preserve the attempted save/follow/claim context through login |

### Representative Scout results screen

```text
┌──────────────────────────────────────┐
│ MealScout             Saved  Account │
│ [ What are you craving?          🔍 ]│
│ [Near Downtown ▾] [Open now] [Filters]
│ [List] [Map]                         │
├──────────────────────────────────────┤
│ Best matches                         │
│ [food image] Business · 0.8 mi       │
│ Dish/cuisine reason · Open until 9   │
│ $12–18             View profile      │
│                                      │
│ Serving nearby                       │
│ [truck image] Truck · Live now       │
│ Current stop · 1.2 mi   Directions   │
│                                      │
│ Deals and events matching this search│
└──────────────────────────────────────┘
Bottom navigation: Scout · Saved · Activity · Account
```

---

## 5. Business information architecture and workflows

### Shared workspace shell

The workspace is scoped to one selected business identity. Identity selection, completion status, public-profile preview, and urgent operational state remain visible across modules.

| Module | Responsibility |
|---|---|
| Overview | Today’s status, setup gaps, operational alerts, recent outcomes, next best action |
| Public profile | Name, type, cuisine/category, description, contact, location/service area, amenities, primary actions |
| Menu or offerings | Categories/items/prices/availability, or persona-appropriate catalog/packages |
| Hours/schedule/availability | Capability-specific editor and published-state preview |
| Deals/promotions | Create/edit/activate current supported promotions |
| Media | Logo, cover, gallery, menu/service imagery, upload status |
| Orders/bookings/requests | Persona-specific work queue; not one generic data model |
| Audience/analytics | Existing views, actions, attribution, deal/profile outcomes without vanity-dashboard overload |
| Team | Members, invites, permissions |
| Payments | Profile access, transaction-payment setup, payout state, and supported actions |
| Settings | Business-level settings, attribution, integrations, support links; account settings remain separate |

### Capability matrix

Legend: Core = normal module; Conditional = shown only when backed by current capability/configuration; Specialized = distinct workflow inside the shared shell; — = absent.

| Business type | Profile | Offerings | Availability | Promotions | Media | Work queue | Audience | Team | Payments |
|---|---|---|---|---|---|---|---|---|---|
| Restaurant | Core | Menu | Hours | Deals | Core | Orders/bookings | Core | Core | Conditional |
| Food truck | Core | Menu | Schedule + Go live | Deals | Core | Orders/bookings/parking | Core | Core | Conditional |
| Bar | Core | Menu/offerings | Hours | Deals/events | Core | Orders/bookings | Core | Core | Conditional |
| Caterer | Core | Packages/menu | Availability/service area | Promotions | Core | Leads/bookings/orders where supported | Core | Core | Conditional |
| Private chef | Core | Offerings | Availability/service area | Promotions if supported | Core | Leads/bookings | Core | Conditional | Conditional |
| Host | Core | Hosting locations/opportunities | Event series/windows | — | Core | Bookings/requests | Specialized | Team if supported | Payouts |
| Supplier | Core | Product catalog | Fulfillment/service area | — | Product media | Orders/requests | Specialized | Team if supported | Stripe/payouts |
| Event coordinator | Core | Events | Event dates/capacity | Event promotion | Event media | Vendor interests/requests | Specialized | Team if supported | Conditional |

### Restaurant workflow

```text
Claim/create business
  → verify identity/account
  → complete identity + location
  → set recurring hours
  → add cover/logo/gallery
  → create/publish menu
  → preview public profile
  → activate supported ordering/deals
  → manage orders and review audience outcomes
```

### Food-truck workflow

```text
Find and claim/create truck
  → verify identity/account
  → complete identity + service area
  → add cover/logo/gallery
  → create/publish menu
  → publish dated stops/schedule
  → optionally start fresh live-location broadcast
  → preview truck profile as diners see it
  → manage parking/event opportunities, orders, and bookings
```

### Business onboarding rules

- Onboarding is a resumable checklist inside the workspace, not a marketing presentation.
- Progress derives from persisted entity state, not visited steps.
- The minimum publishable profile is capability-specific.
- Owners can preview the public result/profile after each meaningful change.
- Claiming, verification, profile completion, media, menu, and schedule are distinct states and must not be collapsed into one “setup complete” boolean.

### Representative business management screen

```text
┌────────────────────────────────────────────────────────┐
│ [Business ▾]  Public profile: Published   Preview      │
├───────────────┬────────────────────────────────────────┤
│ Overview      │ Today                                  │
│ Public profile│ Open 11–9 · Profile visible            │
│ Menu          │ 2 unavailable items · Review menu      │
│ Hours         │                                        │
│ Deals         │ Setup                                  │
│ Media         │  [✓ Identity] [✓ Hours] [! Cover]      │
│ Orders        │                                        │
│ Audience      │ Recent actions                         │
│ Team          │ Directions 24 · Menu opens 61          │
│ Settings      │                                        │
└───────────────┴────────────────────────────────────────┘
Mobile: module list becomes a workspace switcher; urgent status and Preview stay in the header.
```

---

## 6. Canonical navigation

### Consumer mobile

Four destinations:

1. **Scout** — search, filters, list, and map.
2. **Saved** — favorites/follows and other supported saved objects.
3. **Activity** — existing claimed deals, event/order outcomes, and relevant notifications; omit until backed by a coherent current-data view rather than inventing content.
4. **Account** — profile and settings.

If Activity cannot be assembled from existing behavior in its implementation phase, ship three destinations: Scout, Saved, Account. Video, Deals, and Events live in Scout and supporting collection URLs, not the primary bottom bar.

### Consumer desktop

- Left: MealScout identity linking to Scout.
- Center: Scout intent/search and location context when in discovery.
- Right: Saved and Account.
- Contextual collection links may appear inside Scout, not as a permanent wide global menu.

### Business mobile

Four destinations:

1. **Overview**
2. **Work** — Orders, Bookings, Requests, or Opportunities, labeled by persona
3. **Manage** — Profile, menu/offerings, availability, deals, media
4. **More** — Audience, team, payments, settings, switch business, Scout

### Business desktop

- Persistent workspace sidebar: Overview; Public profile; Offerings; Availability; Promotions; Media; Work queue; Audience; Team; Payments; Settings.
- Hide unsupported modules based on capability and permission.
- Header: selected identity, publish/status indicator, Preview profile, and **Scout**.
- Consumer Scout is reachable but does not occupy a peer slot beside Kitchen, Orders, and Share.

### Navigation transition

- Keep existing paths and role router during shell introduction.
- Replace the visual navigation first behind existing route behavior.
- Move destinations into the new hierarchy before redirecting aliases.
- Do not make `/dashboard` responsible for both role resolution and normal within-workspace navigation long term; retain it as a compatibility entry that resolves to the correct workspace Overview.

---

## 7. Page-template system

| Template | Structure | Used by |
|---|---|---|
| Scout discovery shell | Intent/location header, filters, synchronized list/map, contextual preview, resilient state region | Scout and migrated Search entry |
| Public profile | Food-led identity, decision summary, primary action, menu/offerings, availability, location/service area, media/proof, related Scout results | Restaurant, truck, bar, caterer/private chef where supported, host/location, supplier variants |
| Collection/list | Compact title/context, optional filter/sort, consistent entity rows/cards, pagination/continuation, state region | Saved, Deals, Events, Suppliers, Videos, Orders |
| Detail | Entity context, decisive facts, primary action, related owner/profile, share/save | Deal, Event, Video, Review, Supplier detail |
| Business workspace | Identity header, capability navigation, status/preview, module content | All operator personas |
| Editor/form flow | Plain task title, saved-state indicator, grouped fields, inline validation, preview, sticky mobile save | Profile, menu, hours, schedule, media, deals, event/product editors |
| Checkout | Progress, order summary, fulfillment/contact, payment, confirmation; isolated from discovery chrome | Menu cart, checkout, order confirmation, supported event/parking payments |
| Account/settings | Account navigation, identity/security/preferences/support sections | Profile, settings, addresses, payment methods, notifications, support |
| Standard state | State title, one-sentence consequence, primary recovery action, optional secondary action | Empty/loading/error/degraded/unavailable across all templates |

### Visual and component rules

- Use a warm light/cream application canvas with high-contrast text; reserve dark surfaces for imagery overlays, maps, and occasional emphasis—not the entire product.
- Core palette: food orange as action color, tomato/coral for urgency, herb green for verified open/live success, warm gold for scheduled/upcoming, neutral clay/cream surfaces.
- Food imagery must represent the result/entity and maintain stable aspect ratios. Logos are identity marks, not substitutes for food photography when approved food imagery exists.
- One surface elevation per semantic layer. Avoid card-inside-card layouts.
- Minimum mobile touch target: 44 px. Primary actions remain reachable without horizontal scrolling.
- Type hierarchy: compact page title, strong entity name, readable body, restrained metadata. No all-caps technical labels.
- Motion is limited to state transition, selected map/result coordination, upload progress, and fresh live presence.
- Scout is an action, not the name of a container. Label the discovery action **Scout** without modifiers; never use “Open Scout” or “the Scout.”

---

## 8. Route disposition matrix

Evidence codes: **R** routed in `App.tsx`; **N** current navigation/reference confirmed; **A** alias shares component; **U** routed with no inbound `client/src` reference confirmed; **M** marketing/SEO intent evident from component/route; **O** authenticated operator/account route; **P** public decision/discovery route.

“Retire” below means a migration target after replacement and traffic verification—not immediate deletion.

| Route | Current component | Audience / purpose | Canonical destination | Decision | Evidence | Risk |
|---|---|---|---|---|---|---|
| `/` | Welcome / RedirectToScout | Guest entry; signed-in discovery entry | Welcome for guests; Scout for signed-in | Keep | R,A | Low |
| `/scout` | ScoutPageV2 | Primary discovery | Scout | Keep | R,N,P | High |
| `/scout/:refTag` | ScoutPageV2 | Referred discovery | Scout with attribution | Keep | R,A | Medium |
| `/scout-v2` | ScoutPageV2 | Version alias | `/scout` | Redirect after reference audit | R,A | Low |
| `/directory` | ScoutPageV2 | Discovery alias | `/scout` | Redirect after SEO audit | R,A | Medium |
| `/directory/:refTag` | ScoutPageV2 | Referred alias | `/scout/:refTag` | Redirect after SEO audit | R,A | Medium |
| `/search` | Search | Separate explicit search | Scout search state | Merge; preserve URL entry | R,P | High |
| `/map` | RedirectToScout | Legacy discovery entry | Scout map state | Keep redirect | R,A | Low |
| `/trending` | RedirectToScout | Legacy discovery entry | Scout trending context | Keep redirect | R,A | Low |
| `/scout-prototype` | ScoutPrototype | Alternate prototype | No canonical public destination | Investigate, then retire | R,U | Medium |
| `/food-truck-rush` | FoodTruckRush | Browser game/promotion | Campaign archive or explicit promo area | Investigate, then move/retire | R,U | Low |
| `/restaurant/:id` | PublicProfilePage | Restaurant decision | Canonical public profile | Keep | R,P | High |
| `/restaurant/:id/:profileSlug` | PublicProfilePage | Profile alias/SEO | Canonical public profile | Keep/normalize canonical metadata | R,A | Medium |
| `/truck/:slug` | PublicProfilePage | Truck decision | Canonical public profile | Keep | R,P | High |
| `/truck/:slug/:refTag` | PublicProfilePage | Referred truck profile | Same profile + attribution | Keep | R,A | Medium |
| `/bar/:slug` | PublicProfilePage | Bar decision | Canonical public profile | Keep | R,P | High |
| `/bar/:slug/:refTag` | PublicProfilePage | Referred bar profile | Same profile + attribution | Keep | R,A | Medium |
| `/location/:slug` | PublicProfilePage | Host/location profile | Canonical location profile | Keep | R,P | High |
| `/location/:slug/:refTag` | PublicProfilePage | Referred location profile | Same profile + attribution | Keep | R,A | Medium |
| `/supplier/:slug` | PublicProfilePage | Supplier public profile | Canonical supplier profile variant | Keep | R,P | High |
| `/supplier/:slug/:refTag` | PublicProfilePage | Referred supplier profile | Same profile + attribution | Keep | R,A | Medium |
| `/p/:profileType/:profileId` | PublicProfilePage | Generic public profile | Canonical entity profile | Keep as compatibility route | R,A | Medium |
| `/p/:profileType/:profileId/:profileSlug` | PublicProfilePage | Generic SEO profile | Canonical entity profile | Keep as compatibility route | R,A | Medium |
| `/:businessSlug` | CleanPublicProfileRoute | Clean business URL | Canonical entity profile | Keep; repair explicit not-found behavior | R,A | High |
| `/:businessSlug/:refTag` | CleanPublicProfileRoute | Referred clean profile | Same profile + attribution | Keep | R,A | High |
| `/menu/:restaurantId` | OnlineMenuPage | Menu/order entry | Canonical menu template | Keep | R,P | High |
| `/checkout/:restaurantId` | PickupCheckoutPage | Checkout | Checkout flow | Keep | R,P | Critical |
| `/order-confirmation/:orderId` | OrderConfirmationPage | Transaction result | Checkout confirmation | Keep | R,P | Critical |
| `/restaurant/:restaurantId/reviews` | ReviewsPage | Restaurant reviews | Profile proof/detail | Keep, visually merge with profile system | R,P | Medium |
| `/deals` | FeaturedDealsPage | Deal collection | Scout Deals collection | Keep URL; merge visual shell | R,P | Medium |
| `/deals/featured` | FeaturedDealsPage | Featured alias | `/deals` | Redirect after attribution audit | R,A | Low |
| `/deals/:city` | DealsCityPage | City deals | Scout Deals with city context | Keep SEO entry; merge visual shell | R,M | Medium |
| `/deal/:id` | DealDetail | Deal decision/claim | Canonical detail template | Keep | R,P | High |
| `/events` | EventsRouter | Role-aware event entry | Consumer Events or operator Work | Keep compatibility router | R,N | High |
| `/events/public` | EventsPage | Public event collection | Scout Events collection | Keep URL; merge visual shell | R,P | Medium |
| `/event/:slug` | EventDetailPage | Event decision/booking | Canonical detail template | Keep | R,P | High |
| `/favorites` | Favorites | Saved restaurants | Saved | Keep and expand only with supported entities | R,N | Medium |
| `/user-dashboard` | UserDashboard | Claimed deals/favorites/recommendations | Saved + Activity/account | Merge, then redirect | R | Medium |
| `/video` | VideoPage | Food video collection/upload | Scout media collection | Move from primary nav; keep URL | R,N | Medium |
| `/video/:id` | VideoDetailPage | Video/story detail | Canonical detail template | Keep | R,P | Medium |
| `/category/:category` | CategoryPage | Category discovery | Scout category state | Keep SEO entry; merge/redirect after parity | R,M | Medium |
| `/city/:city` | CityLanding | City acquisition/discovery | SEO landing → Scout with city context | Keep | R,M | Medium |
| `/city/:city/:mode` | CityDiscoveryPage | Time-mode city discovery | Scout with city/time context | Merge; preserve indexable route if valuable | R,M | Medium |
| `/city/:city/food` | PublicSeoLandingPage | City food SEO | SEO template → Scout | Keep/merge template | R,M | Medium |
| `/food-trucks/:citySlug` | CityLanding | City truck SEO | SEO template → Scout trucks | Keep | R,M | Medium |
| `/food-trucks/:citySlug/:cuisineSlug` | CityLanding | City/cuisine truck SEO | SEO template → Scout filters | Keep | R,M | Medium |
| `/food-trucks-today/:city` | PublicSeoLandingPage | Today truck SEO | SEO template → Scout live/scheduled | Keep | R,M | Medium |
| `/deals-today/:city` | PublicSeoLandingPage | Today deals SEO | SEO template → Scout Deals | Keep | R,M | Medium |
| `/events-today/:city` | PublicSeoLandingPage | Today events SEO | SEO template → Scout Events | Keep | R,M | Medium |
| `/cuisine/:type` | PublicSeoLandingPage | Cuisine SEO | SEO template → Scout cuisine | Keep | R,M | Medium |
| `/cuisine/:cuisine/:city` | PublicSeoLandingPage | City cuisine SEO | SEO template → Scout filters | Keep | R,M | Medium |
| `/locations-with-trucks/:city` | PublicSeoLandingPage | Host/truck-location SEO | SEO template → Scout | Keep | R,M | Medium |
| `/location/:slug/food-trucks` | LocationDetailPage | Trucks at a location | Location profile related discovery | Merge into location profile; preserve URL | R,P | Medium |
| `/location/:slug/food-trucks-now` | LocationDiscoveryPage | Current trucks at location | Scout/location live state | Merge; preserve URL entry | R,P | Medium |
| `/location/:slug/food-trucks-tonight` | LocationDiscoveryPage | Tonight trucks at location | Scout/location time state | Merge; preserve URL entry | R,P | Medium |
| `/truck-discovery` | TruckDiscovery | Open calls/events for trucks | Business Work: Opportunities | Move into truck workspace; preserve URL | R,N,O | High |
| `/golden-plate-winners` | GoldenPlateWinners | Awards promotion | Campaign/archive or Scout collection | Investigate, then move/retire | R,U | Low |
| `/pensacola/spots` | PensacolaSpots | Regional parking lead campaign | Campaign page → relevant workspace/Scout | Keep pending campaign audit | R,M | Medium |
| `/pensacola/report` | PensacolaReport | Regional lead magnet | Campaign page | Keep pending campaign audit | R,M | Medium |
| `/login` | Login | Authentication | Account/auth flow | Keep | R | High |
| `/customer-signup` | CustomerSignup | Account/persona funnel | Account creation | Keep; simplify presentation | R | High |
| `/customer-signup/:refTag` | CustomerSignup | Referred signup | Same + attribution | Keep | R,A | High |
| `/restaurant-signup` | RestaurantSignup | Create/claim food business | Workspace onboarding | Keep entry; merge flow shell | R,O | High |
| `/host-signup` | HostSignup | Create host identity | Workspace onboarding | Keep; normalize form pattern later | R,O | High |
| `/claim-business` | ClaimTruckPage | Search/claim listing | Workspace onboarding: Claim | Keep canonical claim entry | R,N,O | High |
| `/claim-business/:refTag` | ClaimTruckPage | Referred claim | Same + attribution | Keep | R,A | High |
| `/claim-truck` | ClaimTruckPage | Truck-specific alias | `/claim-business` with truck context | Redirect after parity | R,A | Medium |
| `/claim-truck/:refTag` | ClaimTruckPage | Referred truck alias | `/claim-business/:refTag` with context | Redirect after parity | R,A | Medium |
| `/account-setup` | AccountSetup | Complete account | Onboarding/auth continuation | Keep | R | High |
| `/owner/verify` | AccountSetup | Owner setup alias | Account setup | Keep/redirect after token audit | R,A | High |
| `/post-verification` | PostVerification | Email verification | Onboarding/auth continuation | Keep | R | High |
| `/forgot-password` | ForgotPassword | Recovery | Account/auth flow | Keep | R | High |
| `/reset-password` | ResetPassword | Recovery | Account/auth flow | Keep | R | High |
| `/change-password` | ChangePassword | Security | Account settings | Keep | R | High |
| `/ref/:tag` | ReferralRedirect | Attribution redirect | Intended destination with attribution | Keep | R | High |
| `/dashboard` | DashboardRouter | Role resolver | Persona workspace Overview | Keep compatibility entry | R,N,O | High |
| `/restaurant-owner-dashboard` | RestaurantOwnerDashboard | Restaurant/truck operations | Business workspace | Keep during decomposition | R,N,O | High |
| `/restaurant/dashboard` | RestaurantOwnerDashboard | Owner alias | Business workspace Overview | Redirect after shell parity | R,A,O | Medium |
| `/menu-builder` | MenuBuilderPage | Menu CRUD | Workspace: Menu | Move into shell; preserve URL | R,O | High |
| `/deal-creation` | DealCreation | Deal creation | Workspace: Promotions | Move into shell; preserve URL | R,O | High |
| `/deal-edit/:dealId` | DealEdit | Deal editing | Workspace: Promotions editor | Move into shell; preserve URL | R,O | High |
| `/orders` | Orders | Operator orders | Workspace: Work/Orders | Move into shell; preserve URL | R,N,O | Critical |
| `/kitchen` | KitchenDisplayPage | Kitchen fulfillment | Workspace: Work/Kitchen, fullscreen capable | Keep specialized; link from shell | R,N,O | Critical |
| `/parking-pass` | ParkingPassPage | Truck/host parking marketplace/booking | Workspace Opportunities/Bookings; public entry as applicable | Move visually, preserve behavior/URL | R,N,O | Critical |
| `/parking-pass-manage` | ParkingPassManage | Parking management | Workspace: Work/Hosting | Move into shell; preserve URL | R,O | High |
| `/host/dashboard` | HostDashboard | Host operations | Host workspace Overview | Keep; adopt shell | R,O | High |
| `/event-coordinator/dashboard` | EventCoordinatorDashboard | Event operations | Event workspace Overview/Work | Keep; adopt shell | R,N,O | High |
| `/supplier/dashboard` | SupplierDashboardPage | Supplier operations | Supplier workspace Overview | Keep; adopt shell | R,N,O | High |
| `/suppliers` | SuppliersPage | Browse suppliers + restaurant requests | Supplier marketplace collection | Keep; clarify consumer/operator context | R | High |
| `/suppliers/:supplierId` | SupplierDetailPage | Supplier detail | Canonical supplier detail/profile | Keep | R | High |
| `/supply/orders` | SupplyOrdersPage | Restaurant supply orders | Workspace: Work/Supply orders | Move into shell; preserve URL | R,N,O | High |
| `/business-team` | BusinessTeamPage | Team management | Workspace: Team | Move into shell; preserve URL | R,O | High |
| `/business-team/accept` | BusinessTeamAcceptPage | Invite acceptance | Auth/onboarding utility | Keep standalone | R | High |
| `/affiliate/earnings` | AffiliateEarnings | Referral earnings | Workspace/Account: Attribution | Move into appropriate shell | R,O | High |
| `/share-hub` | ShareHubPage | Referral sharing | Contextual share/attribution utility | Remove from primary nav; keep URL | R,N | Medium |
| `/subscribe` | Profile access | Non-expiring free trial | Workspace: Profile access | Preserve URL for compatibility; no recurring checkout | R,N | Critical |
| `/profile` | Profile | User identity | Account | Keep | R,N | High |
| `/profile/settings` | SettingsPage | Account and mixed business settings | Account settings; move business gallery/domain controls to workspace | Repair/split by ownership | R,O | High |
| `/settings` | SettingsPage | Settings alias | `/profile/settings` | Redirect after deep-link audit | R,A | Medium |
| `/profile/addresses` | AddressesPage | Saved addresses | Account settings | Keep | R | High |
| `/profile/payment` | PaymentMethodsPage | Payment methods | Account settings | Keep | R | Critical |
| `/profile/notifications` | NotificationsPage | Notification preferences | Account settings | Keep | R | High |
| `/profile/help` | HelpSupportPage | Support tickets | Account/workspace help | Keep shared utility | R | Medium |
| `/profile/reporter-reputation` | ReporterReputationPage | Reporter status | Account detail | Keep pending product relevance review | R | Medium |
| `/profile-setup` | ProfileSetupPage | Static profile-service marketing | Marketing page with honest route/title | Move/rename; preserve URL redirect | R,M | Low |
| `/hiring` | HiringPage | Jobs/private-chef marketplace | Supporting marketplace collection | Keep; separate modes inside template | R | High |
| `/jobs` | HiringPage | Jobs alias | Hiring jobs state | Keep/normalize | R,A | Medium |
| `/private-chefs` | HiringPage | Private-chef state | Scout/service-provider collection or hiring mode | Investigate product intent before merge | R,A | High |
| `/about` | About | Company information | Marketing | Keep | R,M | Low |
| `/faq` | FAQ | Help/marketing | Marketing/help | Keep | R,M | Low |
| `/how-it-works` | HowItWorks | Product education | Marketing | Keep, shorten application-entry copy | R,M | Low |
| `/contact` | Contact | Contact | Marketing/help | Keep | R,M | Low |
| `/install` | InstallApp | Install/PWA | Account/marketing utility | Keep | R,M | Low |
| `/for-restaurants` | ForRestaurants | Acquisition | Business marketing | Keep | R,M | Low |
| `/for-bars` | ForBars | Acquisition | Business marketing | Keep | R,M | Low |
| `/for-hosts` | ForHosts | Acquisition | Business marketing | Keep | R,M | Low |
| `/for-events` | ForEvents | Acquisition | Business marketing | Keep | R,M | Low |
| `/host-location-partner` | HostLocationPartnerPage | Host acquisition | Business marketing/onboarding entry | Keep | R,M | Low |
| `/compare` | ComparePage | Comparison hub | Marketing/SEO | Keep pending traffic audit | R,M | Low |
| `/compare/doordash` | CompareDoorDashPage | Competitor comparison | Marketing/SEO | Keep pending traffic audit | R,M | Low |
| `/compare/uber-eats` | CompareUberEatsPage | Competitor comparison | Marketing/SEO | Keep pending traffic audit | R,M | Low |
| `/compare/grubhub` | CompareGrubhubPage | Competitor comparison | Marketing/SEO | Keep pending traffic audit | R,M | Low |
| `/compare/:service/local/:city/:cuisine` | ServiceCompareLandingPage | Programmatic comparison SEO | Marketing/SEO → Scout | Keep pending SEO audit | R,M | Medium |
| `/delivery-app-alternatives` | DeliveryAppAlternativesPage | Comparison SEO | Marketing/SEO | Keep pending traffic audit | R,M | Low |
| `/online-ordering-platforms` | OnlineOrderingPlatformsPage | Business comparison SEO | Business marketing | Keep pending traffic audit | R,M | Low |
| `/terms-of-service` | TermsOfService | Legal | Legal utility | Keep | R | Critical |
| `/privacy-policy` | PrivacyPolicy | Legal | Legal utility | Keep | R | Critical |
| `/moderation-policy` | ModerationPolicy | Policy | Legal/trust utility | Keep | R | High |
| `/data-deletion` | DataDeletion | Privacy request | Account/legal utility | Keep | R | Critical |
| `/sitemap` | Sitemap | Sitemap/user index | SEO utility | Keep | R | Medium |
| `/status` | StatusPage | Service status | Support utility | Keep | R | Medium |
| `/staff` | StaffDashboard | Staff operations | Staff workspace | Keep outside first rebuild | R,N | High |
| `/admin` | AdminLogin | Admin entry | Admin auth | Keep | R | Critical |
| `/admin/login` | AdminLogin | Admin auth | Admin auth | Keep | R,A | Critical |
| `/admin/dashboard` | AdminLogin / AdminDashboard | Guest guard / admin operations | Admin workspace | Keep | R | Critical |
| `/admin/control-center` | AdminControlCenter | Admin operations | Admin workspace | Keep | R,N | Critical |
| `/admin/affiliates` | AdminAffiliateManagement | Affiliate admin | Admin workspace | Keep | R | High |
| `/admin/audit-logs` | AdminAuditLogs | Audit | Admin workspace | Keep | R | Critical |
| `/admin/incidents` | AdminIncidents | Incident management | Admin workspace | Keep | R | Critical |
| `/admin/tickets` | AdminSupportTickets | Support admin | Admin workspace | Keep | R | High |
| `/admin/moderation` | AdminModerationEvents | Moderation events | Admin workspace | Keep | R | Critical |
| `/admin/moderation/queue` | ModerationQueue | Moderation queue | Admin workspace | Keep | R | Critical |
| `/admin/moderation/appeals` | AdminModerationAppeals | Appeals | Admin workspace | Keep | R | Critical |
| `/admin/moderation/metrics` | AdminModerationMetrics | Moderation metrics | Admin workspace | Keep | R | High |
| `/admin/moderation/videos` | AdminModerationVideos | Video moderation | Admin workspace | Keep | R | Critical |
| `/admin/vac-logs` | AdminVacLogs | Safety logs | Admin workspace | Keep | R | Critical |
| `/admin/telemetry` | AdminTelemetry | Telemetry | Admin workspace | Keep | R | High |
| `/admin/geo-ads` | AdminGeoAds | Geo ad management | Admin workspace | Keep | R | High |
| `/admin/geo/heatmap` | AdminMarketHeatmap | Market reporting | Admin workspace | Keep; token adoption later | R,N | Medium |
| `/admin/giveaway-wheel` | AdminGiveawayWheel | Promotion tool | Admin workspace/fullscreen tool | Keep | R | Medium |
| `/admin/switcher` | DashboardSwitcherPage | Parallel dashboard switcher | Admin workspace navigation | Merge role resolution, then retire route if unused | R | High |
| `/admin/oauth-setup` | OAuthSetupGuide | Admin setup guide | Admin workspace/help | Keep | R | High |

---

## 9. Component consolidation matrix

| Area | Current fragmentation | Canonical decision | Preserve distinct behavior | Migration guard |
|---|---|---|---|---|
| Maps | Google surface, Leaflet usage, themed map v1/v2, SVG street map, preview sheet | One map adapter and one Scout map/list selection model; use the production-capable provider already serving required coordinates/interactions | Admin heatmap and non-geographic visualizations remain separate | Provider/runtime fallback and marker parity tests before replacing any map |
| Location/radius | Scout and Search own orchestration despite shared storage key | One `DiscoveryContext` contract for chosen/current location, radius, viewport, permission, and persistence | Checkout/delivery address and business service area remain separate concepts | URL/storage compatibility tests |
| Search | Scout inline search and `smart-search` on Search page | Scout intent controller and shared suggestion/result contract | SEO landing query parsing remains server/index oriented | Preserve `/search` deep links and telemetry |
| Sharing | Deal share modal, share buttons, Share Hub/referral tools | One contextual Share action primitive; one referral/affiliate link builder | Referral earnings/Share Hub are business growth workflows, not generic share UI | Attribution-tag tests |
| Payment modals | Parking and event modals repeat shell/confirm structure | Shared payment-flow frame around existing Stripe Elements/configuration | Booking payloads, pricing, cancellation, Connect accounts remain domain-specific | No payment behavior change; end-to-end sandbox tests |
| Upload/media | Orphan uploader plus page-specific upload/import UI | Shared media uploader/view model using existing routes and status fields | Menu document import, product media, profile gallery, logo, and cover retain domain validation | Upload persistence, approval, ownership, and refresh tests |
| Profile gallery | Owner dashboard and generic Settings both edit business media | Business gallery lives in workspace Media; Account Settings no longer owns business presentation | Personal profile image remains account-owned | Permission and business-identity tests |
| Error/empty states | Profile, map, Scout, and page-local variants | Shared state anatomy and tokens with surface-specific copy/recovery | Error boundaries stay scoped to failure domains | Fault-injection and accessibility tests |
| Business claims | Claim page and signup branch both orchestrate claims | One Claim Business flow service and editor shell | Create-new-business and claim-existing remain separate branches | Referral, verification, duplicate-claim tests |
| Menu API access | Owner and public endpoints used from multiple pages | Shared typed client/query layer over current endpoints | Owner CRUD permissions and public reads remain separate | API contract tests; no endpoint replacement in UI phase |
| Dashboard role resolution | Navigation lane logic, DashboardRouter, DashboardSwitcher | One role/capability workspace resolver; `/dashboard` remains compatibility entry | Admin/staff security guards remain explicit | Multi-role persona matrix tests |
| Entity paths | Multiple public aliases | Shared path builder and canonical metadata | Attribution routes preserve ref tags | Alias/SEO/referral tests |
| Availability | Boolean/status/schedule/live inputs and multiple labels | Shared presentation model with entity-specific adapters | Hours, stops, broadcasts, event series remain separate data/mutations | Timezone, freshness, stale-live, overnight-hours tests |
| CTA policy | Shared profile ranking plus local Scout/truck compositions | One action-policy vocabulary and ranking input per entity/context | Checkout, claim, owner edit, and external actions retain domain guards | Analytics action-name and destination parity tests |
| Business taxonomy | Shared food-business capabilities plus role checks | Use capability helpers for module visibility and terminology | Host, supplier, event coordinator are separate entity families | Permission and unsupported-module tests |

`ImageUploader.tsx` is confirmed unreferenced, but removal should wait until the shared media slice proves no static test or out-of-tree import depends on it.

---

## 10. Surfaces to retain, repair, merge, move, or investigate

### Retain

- Scout as canonical discovery.
- Shared public-profile routing and entity-aware profile variants.
- Menu, checkout, order confirmation, deal detail, event detail.
- Capability-specific business operations and current APIs.
- SEO/campaign routes until traffic and campaign dependencies are checked.
- Admin/staff tools outside the initial rebuild.

### Repair

- Scout decomposition and mobile interaction hierarchy.
- Clean-slug profile not-found state.
- Shared status language for open/live/scheduled/stale/missing.
- Business media ownership and persistence feedback.
- Account vs. business settings ownership.
- Role/capability navigation resolution.

### Merge visually or architecturally

- Search into Scout search mode.
- Map/list into one selection model.
- Favorites and supported user-dashboard content into Saved/Activity.
- City/cuisine/time landing templates while preserving distinct URLs and metadata.
- Owner profile/gallery controls into workspace Profile and Media.
- Claim entry points into one claim orchestration.

### Move

- Video, Events, and Deals out of permanent consumer primary navigation and into Scout/supporting collections.
- Menu Builder, Deal editors, Team, Profile access, Affiliate, and supply orders into the business workspace shell while preserving URLs.
- Truck Discovery into truck Opportunities/Work.
- Static Profile Setup copy into honestly named business marketing content.

### Investigate before retirement

- Scout Prototype, Food Truck Rush, Golden Plate Winners.
- Campaign and comparison routes.
- Dashboard Switcher route.
- Reporter reputation product role.

---

## 11. Phased migration plan

| Phase | Complete vertical outcome | Main work | Behavioral boundary | Rollback boundary |
|---|---|---|---|---|
| 0. Baseline | Current tasks are testable | Route screenshots, persona fixtures, contract inventory, analytics-event inventory | Read-only | No production change |
| 1. Tokens and shells | Existing pages render in coherent consumer/business chrome | Warm tokens, typography, spacing, state anatomy, consumer nav, workspace shell scaffolding | Keep current routes/components/data | Shell feature flag or isolated shell revert |
| 2. Scout → profile | Diner searches, filters, switches map/list, opens profile, returns intact | Scout shell, unified discovery context, result card, selected marker/preview, navigation context | Same Scout/profile APIs and mutations | Route-level Scout shell switch |
| 3. Public profile + menu | Restaurant/truck decision journey is complete | Profile template, status grammar, media resolver use, menu entry, related Scout | No CTA destination/payment/menu API changes | Entity template flag |
| 4. Saved/deals/events | Diner can save and revisit, browse contextual deals/events | Saved collection, collection/detail templates, Scout integrations | Existing favorites/follows/claims/events behavior | Per-collection route flag |
| 5. Workspace shell | Operator reaches one identity-scoped Overview and modules | Role/capability resolver, business nav, onboarding progress, Preview profile/Scout | Existing dashboards remain mounted behind modules | `/dashboard` resolver fallback |
| 6. Restaurant + truck | Core operators complete profile/menu/media/hours or schedule/live workflows | Profile, Menu, Media, Hours, Truck Schedule/Go Live, Orders links | Preserve APIs, permissions, upload approval, broadcast freshness | Module-by-module fallback to old page |
| 7. Remaining personas | Host, supplier, coordinator, caterer/private-chef workflows adopt shell | Specialized modules and terminology | Preserve distinct domain models | Persona-level shell flag |
| 8. Legacy retirement | Aliases and unlinked surfaces are safely resolved | Traffic audit, redirects, contract replacement, dead import removal | No removal before replacement and reference check | Restore route/import until next release |

### Test strategy

- Visual regression at mobile widths 360/390/430 and desktop 1280/1440 for each canonical template.
- Behavioral route tests for direct entry, browser back, auth interruption, referral tags, and role routing.
- Contract tests for existing APIs and analytics events.
- Persona tests for guest, diner, restaurant owner, truck owner, host, supplier, event coordinator, multi-role, staff/admin.
- State tests for loading, empty, denied location, API degradation, stale truck broadcast, missing schedule/menu/media, unavailable item, and payment configuration failure.
- Accessibility checks for focus order, keyboard map/list alternatives, dialog focus trapping, touch targets, headings, labels, and color contrast.

---

## 12. First implementation slice

### Slice: shared visual foundations and shell adapters

Goal: make MealScout visibly one product without changing route responsibilities, API calls, mutations, payments, permissions, or production data.

Included:

1. Define semantic warm-light tokens while mapping existing token names for compatibility.
2. Add consumer and business shell layouts that can wrap current route components.
3. Replace the six-slot mixed-role presentation with approved consumer/business navigation while preserving all destinations through the compatibility More/workspace menus.
4. Add shared page header, state anatomy, surface, action, and food-image frame primitives.
5. Apply the consumer shell only to Welcome, Scout, Search, Favorites, and public-profile route boundaries without redesigning their inner content yet.
6. Apply the workspace shell only to `/dashboard` and restaurant-owner dashboard boundaries, with the old dashboard content mounted unchanged.
7. Add screenshot and navigation tests before any inner page rebuild.

Explicitly excluded:

- Scout result logic or map-provider replacement.
- Profile content redesign.
- Upload changes.
- Menu/order/payment changes.
- API/schema changes.
- Route redirects or deletions.
- Admin/staff redesign.

### Files expected to change in the first slice

Exact names may be adjusted to fit repository conventions, but scope should remain:

- `client/src/index.css` — semantic token aliases and base canvas/type rules.
- `client/src/App.tsx` — shell composition only; no route deletion or API behavior.
- `client/src/components/navigation.tsx` — consumer/operator shell navigation presentation.
- `client/src/components/dashboard-switcher.tsx` — role-resolution handoff or deprecation adapter, not immediate removal.
- `client/src/pages/dashboard-router.tsx` or its actual resolver file — workspace entry adapter only.
- New `client/src/components/shell/ConsumerShell.tsx`.
- New `client/src/components/shell/BusinessWorkspaceShell.tsx`.
- New `client/src/components/shell/AccountShell.tsx` if needed by current settings composition.
- New `client/src/components/system/PageState.tsx` and narrowly scoped visual primitives.
- Existing route/shell contract tests under `scripts/` and visual/e2e coverage in the repository’s established test location.

The first slice should not modify currently dirty `client/src/pages/public-profile.tsx`, `client/src/lib/dishCategoryPhoto.ts`, or `scripts/data/` unless those changes are separately reviewed and intentionally included.

---

## 13. Acceptance criteria

### Architecture approval criteria

- Every routed user-facing surface has a target disposition above.
- Scout is the only primary consumer discovery surface.
- Search, map, deals, events, and video have defined supporting relationships to Scout.
- Restaurants and trucks share a workspace without erasing their different availability workflows.
- Host, supplier, and event workflows remain specialized where the data differs.
- Route retirement is conditional on runtime/reference/traffic verification.

### First-slice behavioral criteria

1. A guest can open Welcome, scout, search, view a profile, and log in using the same routes and APIs as before.
2. A diner can Scout, open Saved, and open Account from mobile and desktop navigation.
3. A restaurant owner lands in the correct workspace and can still reach Orders, Kitchen, Menu, Profile, Hours, Media, Team, Profile access, and Scout.
4. A food-truck owner can still reach schedule/parking, live tools, orders, kitchen, events/opportunities, and Scout.
5. Hosts, suppliers, and event coordinators resolve to their current dashboards and work queues through the new shell.
6. Multi-role precedence is covered by tests and does not silently hide the secondary host/business identity.
7. No payment, checkout, ordering, booking, claim, upload, approval, affiliate, or permission payload changes.
8. Existing referral tags and clean/public profile routes continue to resolve.
9. Mobile navigation fits at 360 px without clipped labels or controls and all targets are at least 44 px.
10. Desktop navigation no longer presents a floating consumer/business mixture as the sole IA.
11. Light/warm shell meets WCAG AA text contrast; dark map/image overlays remain readable.
12. Loading, empty, error, and degraded shell states are keyboard and screen-reader accessible.
13. Existing route and contract suites pass; new persona-navigation and visual baselines pass.

### Vertical-journey acceptance criteria for later phases

- Scout query, filters, map viewport, selected result, and back-navigation context remain synchronized.
- Restaurant profile accurately shows food, location, recurring hours, menu state, and available primary action.
- Truck profile distinguishes fresh live broadcast from schedule-derived serving state and stale location.
- Menu clearly represents categories, prices, item availability, missing information, and supported modifiers.
- Owner edits persist after refresh and appear on the correct public entity after approval rules are applied.
- Every business module is gated by existing capability, role, ownership, and permission data.

---

## 14. Explicit objections, risks, and stop conditions

### Objections

- Do not decompose large files merely to reduce line count. Decomposition must follow the approved page templates, state ownership, and vertical journeys.
- Do not replace all maps at once. First define the shared result/selection contract and prove provider parity.
- Do not present caterer/private-chef modules solely because a capability constant exists; verify their current APIs and permissions in that persona phase.
- Do not merge host schedules, truck stops, restaurant hours, and event dates into one generic editor.
- Do not turn Saved or Activity into speculative social feeds.
- Do not move payment forms into a shared abstraction that changes Stripe behavior or domain payloads.

### Principal risks

| Risk | Consequence | Control |
|---|---|---|
| Scout’s size couples unrelated state | Regressions across map, search, cards, and telemetry | Extract one state boundary at a time behind route-level rollback |
| Multi-role users | Wrong workspace or hidden tools | Persona matrix and explicit business identity switcher |
| Route alias/SEO changes | Lost traffic or attribution | Canonical metadata first; redirects only after analytics and ref-tag tests |
| Truck freshness semantics | False “Live now” claims | Shared presentation adapter using current freshness derivation |
| Media approval/ownership | Images disappear or expose unapproved media | Preserve media routes/status and test refresh/public rendering |
| Local cart/payment flows | Lost cart or failed payment | Keep transaction internals out of early visual phases |
| Dirty worktree overlap | User changes overwritten | Isolate architecture/shell changes and review overlap before editing |
| Static-source contract tests | Safe refactor appears failing or deleted source breaks tests | Replace contracts intentionally before source retirement |

### Stop conditions

Stop the relevant migration slice if any of the following occurs:

1. A proposed change requires an API, schema, payment, permission, or production-data mutation not separately approved.
2. A route marked for redirect/retirement lacks confirmed runtime, internal-reference, external-traffic, and contract-test review.
3. A capability or role cannot be derived reliably from current authenticated data.
4. A new shell prevents access to an existing operational tool for any supported persona.
5. Truck live/scheduled/stale states cannot be reproduced deterministically in tests.
6. Media ownership, approval, or post-refresh persistence differs from current server truth.
7. Checkout, booking, profile-access, payout, or claim behavior changes as a side effect of visual work.
8. The slice cannot be rolled back independently from unrelated product changes.

---

## Approval gate

Approval of this packet authorizes only the first implementation slice described above. Each subsequent phase requires a verified vertical-journey plan, current API/permission trace, acceptance tests, and a rollback boundary before implementation.
