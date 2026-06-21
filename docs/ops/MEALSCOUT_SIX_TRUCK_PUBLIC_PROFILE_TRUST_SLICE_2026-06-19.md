Status: `public profile trust completion packet`

# MealScout Six Live Truck Public Profile Trust Slice - 2026-06-19

## 1. Executive decision

Proceed with a docs-only, truck-first public-trust completion lane centered on the six live Scout trucks, with the first operator attention on the thinnest three public profiles:

1. `All Gas No Brakes Reloaded`
2. `CREATIVBOWLS`
3. `Jays Southern Cuisine`

This packet stays inside the route and trust boundaries set by:

- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_2026-06-19.md`
- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_TRIAGE_2026-06-19.md`
- `docs/ops/MEALSCOUT_LIVE_EXPOSURE_SURFACE_CONTAINMENT_AUDIT_2026-06-19.md`

Decision:

- the next completion work should focus on exact public truck trust surfaces, not broad discovery redesign
- the top risk is sparse truck detail pages that feel broken rather than honestly incomplete
- only a small amount of missing data is fillable from already approved evidence in the repo
- the priority-three trucks need owner/Knight evidence before any safe content-apply lane can claim meaningful public improvement

This packet does not mutate production data, change runtime code, change schema, redesign Scout, change map or live-feed behavior, work on B2/internal intake, change admin claiming, or change import tooling.

## 2. Source reports used

Primary reports and evidence packets inspected:

- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_2026-06-19.md`
- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_TRIAGE_2026-06-19.md`
- `docs/ops/MEALSCOUT_LIVE_EXPOSURE_SURFACE_CONTAINMENT_AUDIT_2026-06-19.md`
- `docs/qa/MEALSCOUT_FOUR_DAY_HARDENING_SUMMARY_2026-06-18.md`
- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`
- `docs/evidence/live-scout-truck-evidence-batch-1-2026-06-13.json`
- `docs/evidence/live-scout-truck-evidence-batch-2-2026-06-13.json`
- `docs/evidence/live-scout-truck-evidence-batch-3-2026-06-13.json`
- `docs/evidence/live-scout-truck-blessed-berry-schedule-current-week-2026-06-14.json`
- `docs/evidence/live-scout-truck-blessed-berry-schedule-current-week-apply-2026-06-14.json`
- `docs/evidence/live-scout-truck-review-gated-menu-import-2026-06-14.json`
- `docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json`

Route and trust-contract sources inspected:

- `client/src/App.tsx`
- `client/src/lib/public-profile-path.ts`
- `scripts/public-profile-asset-rendering.contract.test.ts`
- `scripts/public-profile-menu-logo-schedule.contract.test.ts`
- `scripts/public-profile-schedule-state-consistency.contract.test.ts`

## 3. Truck-by-truck public trust status

Public route aliases used in this packet:

- canonical truck profile: `https://www.mealscout.us/truck/{slug}--{uuid}`
- truck alias profile: `https://www.mealscout.us/p/truck/{uuid}`

| Truck | Exact public truck route | Alias route | Logo status | Cover status | Menu status | Schedule status | Social links status | Profile copy/status | Address/location confidence | Public trust risk | Next safest action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `All Gas No Brakes Reloaded` | `https://www.mealscout.us/truck/all-gas-no-brakes-reloaded--6ca08365-f8af-4c1d-9754-6c998c803869` | `https://www.mealscout.us/p/truck/6ca08365-f8af-4c1d-9754-6c998c803869` | `missing` | `missing` | `missing` | `needs_owner_confirmation` | No production socials; source-only Instagram/Facebook candidates | Thin. Production trust is mostly the display name plus honest empty states. | `Unknown` - no verified live stop or map-safe location in repo evidence | `Red` | Preserve honest empty states and request owner/Knight evidence for logo, cover, menu, verified socials, and current stop truth before any apply lane. |
| `CREATIVBOWLS` | `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `missing` in production; `sourced` from owned-site evidence | `missing` in production; `sourced` from owned-site evidence | `missing` in production; `sourced` from owned-site evidence | `needs_owner_confirmation` | Instagram and website live; Facebook is candidate-only | Partial source-backed identity exists, but the public MealScout profile remains sparse. | `Low` - site hints at schedule process, not a current map-safe stop | `Red` | Build an owner/Knight review packet from the owned site for logo, cover, menu, and contact identity; do not claim a current schedule yet. |
| `Jays Southern Cuisine` | `https://www.mealscout.us/truck/jays-southern-cuisine--96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2` | `https://www.mealscout.us/p/truck/96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2` | `missing` | `missing` | `missing` | `needs_owner_confirmation` | No production socials; only a low-confidence Big Jay's candidate exists and is not safe to merge | Thin. Naming hygiene history exists, but there is no trustworthy content packet behind the profile yet. | `Unknown` - no verified live stop or map-safe address | `Red` | Preserve the clean name state and request owner/Knight evidence for every public-facing trust field; do not merge with "Big Jay's" identity without confirmation. |
| `3D Eats & Tea` | `https://www.mealscout.us/truck/3d-eats-tea--95c4e656-f3cc-46ab-ae18-53f549cecfd1` | `https://www.mealscout.us/p/truck/95c4e656-f3cc-46ab-ae18-53f549cecfd1` | `missing` | `applied` | `needs_owner_confirmation` with a richer draft menu packet available | `needs_owner_confirmation` | Website, Instagram, and Facebook are live in production | Partial. The profile has identity, cover, and contact signals, but menu currentness and location truth are still gated. | `Low` - repo evidence explicitly blocks use of static addresses as live map truth | `Yellow` | Keep the current cover and live social/site links, keep schedule empty-state truth, and ask owner/Knight to confirm current menu and live operating location before any menu or map expansion. |
| `Sweet Love` | `https://www.mealscout.us/truck/sweet-love--f3b76054-f355-43b0-a2d3-901277748557` | `https://www.mealscout.us/p/truck/f3b76054-f355-43b0-a2d3-901277748557` | `missing` | `applied` | `sourced` through live Square CTA and review-gated menu artifact | `missing` / `needs_owner_confirmation` | Facebook and Square website/menu CTA are live; no Instagram in production evidence | Partial. Public identity exists, but structured menu completeness and current schedule trust do not. | `Low` - no current schedule evidence safe for map/live claims | `Yellow` | Keep the external menu as source-only trust support, avoid implying complete menu coverage, and request owner/Knight confirmation for structured menu and schedule. |
| `Blessed Berry Bowls` | `https://www.mealscout.us/truck/blessed-berry-bowls--e77ac77a-c432-42d0-ac0f-22c48b6306c9` | `https://www.mealscout.us/p/truck/e77ac77a-c432-42d0-ac0f-22c48b6306c9` | `sourced` | `applied` | `needs_owner_confirmation` | `current_week_only` from operator-uploaded week-of-`2026-06-15` evidence | Social handles and contact details are sourced; full URL cleanup is still gated | Strongest structure of the six, but schedule freshness can decay quickly and logo/menu remain incomplete. | `Medium` - open stops exist, but each exact map pin still needs geocoding | `Yellow` | Keep the schedule explicitly week-bound, geocode open stops before map pin trust, and leave social URL cleanup behind the existing owner-confirmation gate. |

## 4. Missing logo/cover/menu/schedule/social/profile fields

| Truck | Missing or thin trust fields |
| --- | --- |
| `All Gas No Brakes Reloaded` | logo, cover, menu URL, structured menu, schedule, website, socials, profile copy, verified live location |
| `CREATIVBOWLS` | production logo, production cover, production menu URL, structured menu, verified current schedule, confirmed Facebook link, map-safe live location |
| `Jays Southern Cuisine` | logo, cover, menu URL, structured menu, schedule, socials, profile copy, verified live location |
| `3D Eats & Tea` | logo, owner-approved current menu, current posted schedule, confirmed live location, approved logo usage |
| `Sweet Love` | logo, owner-approved structured menu, current posted schedule, broader profile copy confidence |
| `Blessed Berry Bowls` | production logo, owner-approved menu completion, durable schedule beyond the current week, finalized social URL cleanup, geocoded open-stop coordinates |

## 5. Which user-facing routes each gap affects

### Cross-route gap map

| Gap type | Primary user-facing routes affected | Why it hurts trust |
| --- | --- | --- |
| Missing logo | `/scout`, exact truck profile URLs, `/truck/:slug`, `/p/:profileType/:profileId` | Makes cards and heroes feel unfinished or unclaimed |
| Missing cover | exact truck profile URLs, `/truck/:slug`, `/p/:profileType/:profileId` | Makes truck detail pages feel broken or low-effort |
| Missing or owner-unconfirmed menu | exact truck profile URLs, `/truck/:slug`, `/p/:profileType/:profileId`, `/menu/:restaurantId` where linked or inferred | Users can mistake thin menu truth for a broken menu surface |
| Missing or owner-unconfirmed schedule | exact truck profile URLs, `/truck/:slug`, `/p/:profileType/:profileId`, `/food-trucks-today/:city`, `/map` | Users cannot tell whether the truck is active now or stale |
| Weak or unverified social/website identity | exact truck profile URLs, `/truck/:slug`, `/p/:profileType/:profileId`, `/claim-truck` | Makes "Claim or update this profile" feel necessary for the wrong reasons |
| Weak location confidence or ungeocoded stops | `/map`, `/food-trucks-today/:city`, exact truck profile URLs | Location drift damages trust faster than a missing field does |

### Per-truck route pressure

| Truck | Highest-pressure trust routes |
| --- | --- |
| `All Gas No Brakes Reloaded` | `/scout`, exact `/truck/all-gas-no-brakes-reloaded--6ca08365-f8af-4c1d-9754-6c998c803869`, `/p/truck/6ca08365-f8af-4c1d-9754-6c998c803869`, `/claim-truck`, `/restaurant-signup?businessType=food_truck` |
| `CREATIVBOWLS` | `/scout`, exact `/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb`, `/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`, `/food-trucks-today/:city`, `/claim-truck`, `/restaurant-signup?businessType=food_truck` |
| `Jays Southern Cuisine` | `/scout`, exact `/truck/jays-southern-cuisine--96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2`, `/p/truck/96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2`, `/claim-truck`, `/restaurant-signup?businessType=food_truck` |
| `3D Eats & Tea` | `/scout`, exact `/truck/3d-eats-tea--95c4e656-f3cc-46ab-ae18-53f549cecfd1`, `/p/truck/95c4e656-f3cc-46ab-ae18-53f549cecfd1`, `/food-trucks-today/:city`, `/map`, `/menu/:restaurantId` if promoted too strongly |
| `Sweet Love` | `/scout`, exact `/truck/sweet-love--f3b76054-f355-43b0-a2d3-901277748557`, `/p/truck/f3b76054-f355-43b0-a2d3-901277748557`, `/menu/:restaurantId` where menu completeness could be overstated, `/claim-truck` |
| `Blessed Berry Bowls` | `/scout`, exact `/truck/blessed-berry-bowls--e77ac77a-c432-42d0-ac0f-22c48b6306c9`, `/p/truck/e77ac77a-c432-42d0-ac0f-22c48b6306c9`, `/food-trucks-today/:city`, `/map`, `/claim-truck` |

## 6. Which gaps can be filled from existing approved evidence

Safe, already-approved or operator-submitted evidence in the repo is narrow.

| Truck | Gap that can be advanced from existing approved evidence | Boundary |
| --- | --- | --- |
| `Blessed Berry Bowls` | Current-week schedule truth for `2026-06-15` through `2026-06-21` from the operator-uploaded schedule image | Must remain `current_week_only`; must not be reused as recurring after `2026-06-22`; open stops still need geocoding for exact map pins |
| `Blessed Berry Bowls` | Brand/contact evidence from the same operator-submitted image can support later review of phone, website, and handle spelling | Full public social URL correction still remains behind the existing cleanup gate |
| `3D Eats & Tea` | Existing production cover, website, and social links already preserve partial trust | These do not close the missing-logo, current-menu, or live-location gaps |
| `Sweet Love` | Existing production cover plus external Square menu CTA already preserve partial trust | This does not prove structured menu completeness or schedule truth |

Important call:

- no existing approved evidence in the repo safely closes the core logo/cover/menu/schedule gaps for `All Gas No Brakes Reloaded`
- no existing approved evidence in the repo safely closes the core logo/cover/menu/schedule gaps for `Jays Southern Cuisine`
- `CREATIVBOWLS` has promising owned-site evidence, but it is still source-backed candidate evidence, not already-approved apply evidence

## 7. Which gaps require owner/Knight evidence

| Truck | Gaps that still require owner/Knight evidence |
| --- | --- |
| `All Gas No Brakes Reloaded` | logo, cover, menu, website/social identity, current schedule, live operating location, any profile copy beyond display name |
| `CREATIVBOWLS` | approval to use owned-site logo/cover/menu assets, current stop evidence, Facebook confirmation, schedule truth, map-safe live location |
| `Jays Southern Cuisine` | logo, cover, menu, social identity, current schedule, live location, and any confirmation that external "Big Jay's" evidence is actually the same business |
| `3D Eats & Tea` | current menu approval, logo usage approval, live operating location, current stop proof, website/phone overwrite decisions where conflicts exist |
| `Sweet Love` | structured menu extraction approval, current schedule, additional social/profile copy confirmation, any live location proof |
| `Blessed Berry Bowls` | logo apply approval, menu completion approval, recurring schedule reuse approval, social URL correction approval after the cleanup gate |

## 8. Which gaps require geocode before map eligibility

| Truck | Geocode status | Map eligibility rule |
| --- | --- | --- |
| `Blessed Berry Bowls` | Explicit current-week open stops exist, but each open stop is marked `needs_geocode` in the apply artifact | Open stops can support map/live-feed visibility only after exact coordinates are resolved |
| `3D Eats & Tea` | Location evidence is conflicted between static/admin-like addresses and must not be used as live map truth | Do not map from static address candidates; require owner-confirmed live stop or scheduled stop, then geocode |
| `Sweet Love` | No current stop evidence exists in the repo | First obtain current stop evidence, then geocode before map trust claims |
| `All Gas No Brakes Reloaded` | No verified current stop evidence exists in the repo | First obtain current stop evidence, then geocode before map trust claims |
| `CREATIVBOWLS` | Schedule-process clues exist, but no current map-safe stop exists in repo evidence | First obtain current stop evidence, then geocode before map trust claims |
| `Jays Southern Cuisine` | No verified current stop evidence exists in the repo | First obtain current stop evidence, then geocode before map trust claims |

## 9. Which missing fields should render with honest empty/trust labels

Preserve the public-profile truth contract exactly where evidence is missing or not actionable:

- missing or non-actionable schedule: `No schedule posted`
- thin or absent menu evidence: `Menu unavailable right now.` and `Menu: none found.`
- missing map coordinates: `Map coordinates are not available yet.`
- missing cover or logo: keep clean fallback hero/avatar states rather than inventing imagery
- sparse truck trust: keep `Claim or update this profile` visible as the honest recovery path

Per-truck emphasis:

| Truck | Honest empty/trust labels that should remain visible |
| --- | --- |
| `All Gas No Brakes Reloaded` | logo fallback, cover fallback, `No schedule posted`, `Menu unavailable right now.`, `Menu: none found.`, missing-coordinates truth |
| `CREATIVBOWLS` | logo fallback, cover fallback, `No schedule posted`, `Menu unavailable right now.` until owned-site menu evidence is approved, missing-coordinates truth |
| `Jays Southern Cuisine` | logo fallback, cover fallback, `No schedule posted`, `Menu unavailable right now.`, missing-coordinates truth |
| `3D Eats & Tea` | keep the live cover, but preserve `No schedule posted` until actionable rows exist; do not promote static address candidates into map truth |
| `Sweet Love` | keep external menu support honest; do not imply a complete structured menu or posted schedule |
| `Blessed Berry Bowls` | keep schedule language explicitly week-bound and avoid recurring wording; if the current-week schedule expires without refresh, fall back to `No schedule posted` |

## 10. Recommended apply order

Recommended completion order remains aligned with the triage packet:

1. `All Gas No Brakes Reloaded`
2. `CREATIVBOWLS`
3. `Jays Southern Cuisine`
4. `3D Eats & Tea`
5. `Sweet Love`
6. `Blessed Berry Bowls`

Reason:

- the first three are the thinnest public trust profiles and create the strongest broken-profile risk on `/scout` and exact truck profile routes
- `3D Eats & Tea` and `Sweet Love` already have partial trust scaffolding in production
- `Blessed Berry Bowls` already has the strongest visible structure, but it still needs schedule freshness discipline and geocode completion

## 11. Exact next implementation slice

`MealScout Priority Three Thin Profile Trust Apply Prep`

Purpose:

- prepare the first truly safe completion slice for the three thinnest public truck profiles without widening scope into redesign, schema, or production mutation by guesswork

Exact scope:

1. Smoke these exact surfaces for the priority three trucks:
   - `/scout`
   - exact `/truck/{slug}--{uuid}` truck URLs
   - exact `/p/truck/{uuid}` alias URLs
   - `/claim-truck`
   - `/restaurant-signup?businessType=food_truck`
2. Build owner/Knight evidence requests for each priority-three truck covering only:
   - logo
   - cover
   - current menu or menu export
   - current schedule or next confirmed stop
   - verified website/social URLs
   - map-safe live location or stop address
3. Preserve honest empty-state labels until the evidence packet is complete.
4. Keep `/map` and `/food-trucks-today/:city` as downstream trust surfaces, not the leading apply surface for the priority three.
5. After the priority-three packets exist, run the narrowest possible apply review lane in this order:
   - identity/logo/cover
   - verified website/social links
   - owner-confirmed menu truth
   - owner-confirmed schedule truth
   - geocode for exact map eligibility

Secondary contained slice after the priority three:

- `Blessed Berry Bowls current-week schedule freshness and geocode cleanup`

This should stay secondary because it is safer and better sourced, but it does not remove the most obvious sparse-profile risk currently visible to users.

## Scope confirmation

- No runtime code changed in this packet.
- No schema changed in this packet.
- No production data changed in this packet.
- No map or live-feed behavior changed in this packet.
- No B2/internal intake behavior changed in this packet.
- No admin claiming flow changed in this packet.
- No import tooling changed in this packet.
