Status: `surface inventory triage packet`

# MealScout Surface Inventory Triage - 2026-06-19

## Purpose

This is the next docs-only output after the published Surface Inventory baseline.

It uses:

- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_2026-06-19.md`

to isolate the highest-impact user-facing routes for the current six visible Scout trucks and to define the next narrow truck content-completion lane.

This packet does not change runtime code, truck content, schema, production data, map behavior, live-feed behavior, B2/internal intake, admin claiming, or import tooling.

## Baseline

- starting `main`: `02f00be67f5afd9234a181d98ad15f33f4a36620`
- source inventory: `docs/ops/MEALSCOUT_SURFACE_INVENTORY_2026-06-19.md`

Six live Scout trucks in scope:

- `3D Eats & Tea`
- `Blessed Berry Bowls`
- `Sweet Love`
- `All Gas No Brakes Reloaded`
- `CREATIVBOWLS`
- `Jays Southern Cuisine`

## Evidence Basis

Inspected:

- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_2026-06-19.md`
- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`
- `docs/qa/MEALSCOUT_FOUR_DAY_HARDENING_SUMMARY_2026-06-18.md`
- `client/src/App.tsx`
- `client/src/pages/scout-prototype.tsx`
- `client/src/pages/public-profile.tsx`
- `client/src/components/public-profile/TruckHero.tsx`
- `client/src/components/public-profile/truckScheduleTruth.ts`
- `client/src/lib/public-profile-path.ts`

Live proof carried forward from the published inventory:

- production `/api/version`
- production admin request-log smoke
- `scripts/smokeCriticalRoutes.mjs`
- `scripts/smokeScoutSurface.mjs`

Truck-specific completion evidence carried forward from:

- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`

## Triage Rule

This packet cares about routes that affect:

- public discovery
- truck profile entry
- menu trust
- schedule trust
- social and website trust
- owner/update trust
- CTA behavior

It does not care about internal surfaces unless they directly affect what a patron or truck owner sees around the six live trucks right now.

## Highest-Impact User-Facing Routes Right Now

These are the routes that matter most for real users of the six live Scout trucks.

### Tier 1: Direct Patron Value Surfaces

These are the surfaces where missing truck content is most visible and most trust-damaging.

| Route family | Why it matters now | Current route class from inventory | Relevance to six trucks |
| --- | --- | --- | --- |
| `/scout`, `/directory`, `/scout-prototype`, `/food-truck-rush` | First discovery surface for the live truck set; card quality determines whether users click through at all | `Yellow` | Direct for all six |
| `/truck/:slug`, `/p/:profileType/:profileId`, `/:businessSlug` truck-profile equivalents | Main public truck detail entry; where logos, covers, menu truth, schedule truth, socials, and CTAs become obvious | `Green` for smoked subset, otherwise `Yellow` | Direct for all six |
| `/food-trucks-today/:city`, `/food-trucks/:citySlug`, `/food-trucks/:citySlug/:cuisineSlug`, `/city/:city/food`, `/locations-with-trucks/:city` | Truck-first discovery spillover routes that can feed users into the six truck profiles | `Yellow` | Direct discovery support for all six |

### Tier 2: User-Visible Trust Support Surfaces

These routes matter because they shape whether public profile trust looks maintained and current.

| Route family | Why it matters now | Current route class from inventory | Relevance to six trucks |
| --- | --- | --- | --- |
| `/claim-truck`, `/claim-truck/:refTag` | Public truck profile hero explicitly links here for “Claim or update this profile” trust recovery | `Yellow` | Direct owner-trust support for all six |
| `/restaurant-signup?businessType=food_truck` | Public profile related discovery includes “List a food truck”; also the safest exact owner entry | `Green` | Indirect owner trust and update path |
| `/login` | If claim/update flow requires auth, broken login would make public owner recovery feel fake | `Yellow` | Indirect but meaningful |

### Tier 3: High-Risk Adjacent Surfaces

These should not become the working surface for truck completion, but they can make incomplete truck data look worse if users drift into them.

| Route family | Why it matters now | Current route class from inventory | Relevance to six trucks |
| --- | --- | --- | --- |
| `/map` | Live and visible; thin truck data can feel broken faster in a map context | `Yellow` | Direct but secondary |
| `/search`, `/trending`, broad city/category discovery | Can widen user expectations beyond truck-first proof | `Red` | Indirect risk |
| `/menu/:restaurantId`, `/checkout/:restaurantId`, `/order-confirmation/:orderId` | Can overstate menu/ordering completeness if linked or inferred | `Red` | Indirect trust risk, especially where menu data is thin |

## Routes That Are Only Admin, Internal, or Supporting

These routes are not the next content-completion work surface for the six live trucks.

### Admin/Internal

- `/admin/*`
- `/staff`
- `/restaurant-owner-dashboard`
- `/restaurant/dashboard`
- `/dashboard`
- `/user-dashboard`
- `/host/dashboard`
- `/event-coordinator/dashboard`
- `/supplier/dashboard`
- `/supply/orders`
- `/affiliate/earnings`
- `/parking-pass-manage`
- `/business-team`
- `/menu-builder`
- `/kitchen`
- `/subscribe`
- `/deal-edit/:dealId`
- `/profile/*`

These can stay out of the next lane unless they create a proven blocker for public truck trust, which this packet does not show.

### Public But Only Supporting For This Lane

- `/`
- `/about`
- `/faq`
- `/contact`
- `/status`
- `/terms-of-service`
- `/privacy-policy`
- `/moderation-policy`
- `/data-deletion`
- `/share-hub`
- `/parking-pass`
- `/scoutcoin`
- `/video`, `/video/:id`
- `/hiring`, `/jobs`, `/private-chefs`

These may exist in the public shell, but they are not where truck content completion should spend time next.

## Routes To Smoke-Test Before Content Completion

The next lane should smoke-test these exact route families before changing any truck content.

### Required Smoke List

1. `/scout`
Reason:
confirm the six trucks still appear in contained discovery and still click through to public truck profiles without obvious media or naming breakage.

2. Exact public truck profile paths for all six trucks
Reason:
this is where cover/logo, schedule label, menu label, socials, and claim/update trust all become visible at once.

3. Public profile alias shape for the six trucks
Routes:
- `/truck/:slug`
- `/p/:profileType/:profileId`
Reason:
ensure no alias/regression makes content look missing because the user hits a different route shape.

4. `/food-trucks-today/:city`
Reason:
this is the most likely truck-first secondary discovery route to surface content thinness outside Scout.

5. `/claim-truck`
Reason:
the public truck profile explicitly uses this as the recovery/update route. If it feels dead or confusing, profile trust drops even when content is honest.

6. `/restaurant-signup?businessType=food_truck`
Reason:
this remains the safest exact owner entry if claim/update is not the right path.

### Smoke Focus Per Route

For `/scout`:

- truck card title correctness
- image presence or acceptable fallback
- no obviously broken/blank card states
- clickthrough to public truck profile

For truck public profile routes:

- hero cover behavior
- logo behavior
- schedule badge and empty-state truth
- menu badge and empty-state truth
- social and website CTA truth
- “Claim or update this profile” visibility
- no contradictory trust signals

For owner-support routes:

- route loads
- route intent is clear
- no misleading dead-end copy

## Which Routes Are Risky Because Missing Truck Data Makes Them Look Broken

### Highest Risk

| Route | Why missing data hurts here |
| --- | --- |
| `/truck/:slug` and `/p/:profileType/:profileId` | Missing logo/cover/menu/schedule/social data is immediately interpreted as profile emptiness or neglect |
| `/scout` | Weak card imagery or sparse truck metadata lowers click confidence before users even reach the profile |
| `/food-trucks-today/:city` and other truck-first landing pages | Thin truck records can make “today” discovery feel unreliable even when routes themselves work |

### Secondary Risk

| Route | Why it is risky |
| --- | --- |
| `/map` | Trucks with sparse content can feel like ghosts or half-built records in a discovery context |
| `/claim-truck` | If users hit it from a public profile and cannot see a clear path to fix/update the listing, public trust drops |
| `/menu/:restaurantId` | If accidentally reached or implied by CTAs, thin menu data can make the truck feel broken instead of just incomplete |

## Truck Content Gaps Mapped To User-Facing Surfaces

### Cross-Route Gap Mapping

| Content gap | Surfaces affected |
| --- | --- |
| Missing logo | Scout card confidence, public profile hero, profile shareability |
| Missing cover | Public profile hero, perceived completeness, click confidence from Scout |
| Missing or owner-unconfirmed menu | Public profile menu badge, menu section trust, external menu CTA credibility |
| Missing or owner-unconfirmed schedule | Public profile schedule badge, hero primary stop, truck-first “today” discovery trust |
| Missing socials/website cleanup | Public profile social links card, hero website CTA trust |
| Naming/currentness issues | Scout cards, public profile title, slug/share trust |

### Six-Truck Route Risk Matrix

| Truck | Key content gaps from evidence tracker | Most affected surfaces | Primary risk |
| --- | --- | --- | --- |
| `3D Eats & Tea` | logo missing; menu needs owner confirmation; schedule needs owner confirmation | `/scout`, `/truck/:slug`, `/p/:profileType/:profileId`, truck-first city routes | Profile can feel partly complete but still ambiguous on menu/schedule trust |
| `Blessed Berry Bowls` | logo sourced not applied; menu needs owner confirmation; schedule is current-week-only | `/scout`, `/truck/:slug`, `/p/:profileType/:profileId`, `/food-trucks-today/:city` | Schedule can age into false confidence quickly if not treated as current-week-only |
| `Sweet Love` | logo missing; menu sourced not complete; schedule needs owner confirmation | `/scout`, `/truck/:slug`, `/p/:profileType/:profileId` | Menu CTA can over-promise if structured menu completeness is implied too strongly |
| `All Gas No Brakes Reloaded` | logo missing; cover missing; menu missing; schedule needs owner confirmation | `/scout`, `/truck/:slug`, `/p/:profileType/:profileId` | Highest risk of looking broken or abandoned instead of incomplete |
| `CREATIVBOWLS` | logo missing; cover missing; menu missing; schedule needs owner confirmation | `/scout`, `/truck/:slug`, `/p/:profileType/:profileId`, `/food-trucks-today/:city` | Public profile likely feels sparse across all trust surfaces |
| `Jays Southern Cuisine` | logo missing; cover missing; menu missing; schedule needs owner confirmation; prior naming hygiene history | `/scout`, `/truck/:slug`, `/p/:profileType/:profileId` | Sparse content plus naming/currentness drift can make the profile feel unstable |

## Operator Triage Call

### What Routes Matter Most To Users Right Now

Top user-facing routes for the next lane:

1. `/scout`
2. exact public truck profile URLs for the six trucks
3. `/truck/:slug` and `/p/:profileType/:profileId` alias behavior
4. `/food-trucks-today/:city`
5. `/claim-truck`
6. `/restaurant-signup?businessType=food_truck`

### What Routes Do Not Need To Lead The Next Lane

- admin routes
- staff routes
- owner dashboard interiors
- host/event/supplier interiors
- import tooling
- B2/internal intake
- map/live-feed behavior changes
- broad Scout redesign

## Recommended Next Implementation Lane

`MealScout Six Live Truck Content Completion - Public Profile Trust Slice`

### Lane Purpose

Improve the six live truck surfaces that real users see first without widening scope into redesign or broad discovery work.

### Lane Boundaries

Allowed next:

- truck logo completion
- truck cover completion
- menu-trust improvements where evidence already exists
- schedule-truth improvements where evidence already exists
- social/website trust cleanup
- currentness and naming hygiene for the six trucks
- exact route smokes before and after apply

Not allowed next:

- Scout redesign
- map/live-feed behavior changes
- broad restaurant readiness work
- admin claiming workflow changes
- import-tooling changes
- schema changes
- production data mutation without truck-by-truck evidence and explicit apply lane approval

### Recommended First Apply Order

1. `All Gas No Brakes Reloaded`
2. `CREATIVBOWLS`
3. `Jays Southern Cuisine`
4. `3D Eats & Tea`
5. `Sweet Love`
6. `Blessed Berry Bowls`

Reason:
the first three have the thinnest visible public trust surfaces and therefore the highest payoff from narrow completion work, while Blessed Berry has more visible structure already and mostly needs schedule/menu discipline.

## Scope Confirmation

- No runtime code changed in this packet.
- No schema changed in this packet.
- No production data changed in this packet.
- No map or live-feed behavior changed in this packet.
- No B2/internal intake behavior changed in this packet.
- No admin claiming flow changed in this packet.
- No import tooling changed in this packet.
