Status: `priority-three thin profile trust apply-prep packet`

# MealScout Priority Three Thin Profile Trust Apply Prep - 2026-06-21

## 1. Executive decision

Proceed with a docs-only apply-prep lane for the three thinnest live Scout truck profiles:

1. `All Gas No Brakes Reloaded`
2. `CREATIVBOWLS`
3. `Jays Southern Cuisine`

This lane does not apply content.

It defines the structural truth-validation model that must exist before any later content lane can touch verified public-profile fields.

Decision:

- prepare only field-by-field validation rules, evidence classes, overwrite protection, geocode rules, and smoke expectations
- preserve current honest empty states where evidence is missing, weak, stale, inferred, or conflicting
- prevent weaker public-source or inferred data from overwriting stronger verified production truth
- keep the first post-prep apply lane narrow: one truck, one evidence-backed trust improvement, exact-route smoke before and after

This packet does not mutate production data, change runtime code, change schema, apply menus, apply schedules, apply logos, apply covers, apply socials, apply addresses, change map/live-feed behavior, work on B2/internal intake, change admin claiming, or change import tooling.

## 2. Source reports used

Required source reports:

- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_2026-06-19.md`
- `docs/ops/MEALSCOUT_SURFACE_INVENTORY_TRIAGE_2026-06-19.md`
- `docs/ops/MEALSCOUT_SIX_TRUCK_PUBLIC_PROFILE_TRUST_SLICE_2026-06-19.md`

Additional evidence and doctrine inspected:

- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`
- `docs/evidence/live-scout-truck-evidence-batch-1-2026-06-13.json`
- `docs/evidence/live-scout-truck-evidence-batch-3-2026-06-13.json`
- `docs/evidence/live-scout-truck-hygiene-apply-lane-1-2026-06-13.json`
- `docs/evidence/live-scout-truck-hygiene-apply-proposal-2026-06-13.json`
- `docs/qa/MEALSCOUT_FOUR_DAY_HARDENING_SUMMARY_2026-06-18.md`

## 3. Priority trucks and current trust risk

| Truck | Exact public truck route | Alias route | Current trust posture | Current highest-risk gaps | Apply-prep posture |
| --- | --- | --- | --- | --- | --- |
| `All Gas No Brakes Reloaded` | `https://www.mealscout.us/truck/all-gas-no-brakes-reloaded--6ca08365-f8af-4c1d-9754-6c998c803869` | `https://www.mealscout.us/p/truck/6ca08365-f8af-4c1d-9754-6c998c803869` | `Red` | no logo, no cover, no menu, no schedule, no verified socials, no verified location | Prepare owner/Knight evidence request only; keep empty-state truth intact. |
| `CREATIVBOWLS` | `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `Red` | missing logo, cover, menu, schedule, Facebook confirmation, map-safe location | Prepare owned-site evidence review packet; current website and Instagram are protected verified fields. |
| `Jays Southern Cuisine` | `https://www.mealscout.us/truck/jays-southern-cuisine--96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2` | `https://www.mealscout.us/p/truck/96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2` | `Red` | no logo, no cover, no menu, no schedule, no verified socials, no verified location, ambiguous Big Jay's candidate | Protect the cleaned display name and block all identity merges until owner/Knight confirmation resolves ambiguity. |

## 4. Owner-confirmed truth validation model

Truth must be validated in this order before any apply lane:

1. Record the current production truth from the live public profile payload and the currently rendered public routes.
2. Attach source artifacts for the candidate field, not just a summary claim.
3. Classify each artifact using the evidence model in Section 5.
4. Compare evidence strength, currentness, and conflict status against the current production value.
5. Mark the field `prepare`, `apply later`, or `blocked`.
6. Require exact-route smoke expectations before and after any later apply.

Field families allowed to be prepared in this lane:

- `displayName`
- `logoUrl`
- `coverImageUrl`
- `websiteUrl`
- `instagramUrl`
- `facebookPageUrl`
- `menuUrl`
- structured menu rows and section labels
- public schedule rows and labels
- public profile copy or description
- live stop address
- map coordinates

Preparation means:

- document the current production value or honest-empty state
- document the strongest known evidence source
- document whether the field is verified, unverified, stale, conflicting, or blocked
- document the exact overwrite rule for a future apply lane

Preparation does not mean:

- generate new values
- normalize weak guesses into production-ready truth
- treat public-source snippets as owner approval
- mark map-eligible without geocode validation

## 5. Evidence classification rules

| Class | What it means | Apply strength | Notes |
| --- | --- | --- | --- |
| `owner-confirmed` | direct owner-approved artifact or direct owner-approved field packet | strongest | Safe candidate for future apply if current and non-conflicting. |
| `Knight-provided owner-style update` | operator/Knight packet presented as owner-style truth with attached artifacts and explicit field intent | high but not automatic | Safe only if artifact quality is strong, field scope is exact, and no stronger conflicting production truth exists. |
| `public-source observed` | owned site, public social page, public menu page, or public listing observed from source evidence | medium | Useful for preparation and candidate review, not for direct overwrite of verified fields without stronger confirmation. |
| `inferred` | conclusion drawn from snippets, naming similarity, route behavior, or indirect clues | weak | Never enough to overwrite verified truth. |
| `stale` | once-valid evidence with decayed date confidence or expired schedule/menu context | weak | Can support history, not current truth claims. |
| `conflicting` | multiple sources disagree or identity linkage is unresolved | none until resolved | Must block apply until conflict is explicitly resolved. |
| `blocked` | evidence is absent, too weak, off-scope, or prohibited by trust doctrine | none | Preserve empty-state truth and stop the lane from guessing. |

Field approval rule:

- verified production truth can only be overwritten by `owner-confirmed` evidence or by a `Knight-provided owner-style update` with equal-or-stronger field specificity, currentness, and artifact support
- `public-source observed` evidence can prepare a field and justify a future review packet, but it cannot by itself overwrite a verified field
- `inferred`, `stale`, `conflicting`, and `blocked` evidence cannot drive apply

## 6. Verified-field overwrite protection

Verified fields are any public-profile values already present in production or previously cleaned through an approved apply artifact.

Protected verified fields in this lane:

| Field family | Current protected truth | Overwrite rule |
| --- | --- | --- |
| `displayName` | `Jays Southern Cuisine` whitespace trim already applied and must not be replaced with `Big Jay's` variants without owner/Knight identity confirmation | stronger identity evidence required |
| `websiteUrl` | `CREATIVBOWLS` website is already live in production | do not replace with another URL without stronger confirmation |
| `instagramUrl` | `CREATIVBOWLS` Instagram is already live in production | do not replace or normalize from weaker snippets |
| honest empty menu state | missing menu for `All Gas No Brakes Reloaded`, `CREATIVBOWLS`, and `Jays Southern Cuisine` is current truthful output | do not overwrite with inferred or stale menu data |
| honest empty schedule state | `No schedule posted` is current truthful output for the priority three | do not overwrite without current dated evidence and field-specific confirmation |
| honest empty location state | no map-safe current stop is verified for the priority three | do not create map/live claims from static addresses or snippets |

Overwrite doctrine:

- never overwrite a non-null verified field with weaker evidence
- never overwrite a truthful empty state with invented completeness
- never merge a candidate identity into a protected field when the business match is ambiguous
- every future apply lane must list the exact before-value, after-value, source artifact, evidence class, and rollback expectation for each changed field

## 7. Truck-by-truck apply-prep matrix

| Field name | Target truck | Current known status | Evidence required before apply | Current evidence status from docs | Allowed action | Verified-field risk | Public route affected | Smoke test required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `displayName` | `All Gas No Brakes Reloaded` | production display name exists; capitalization trust is not validated in this lane | owner-confirmed name or Knight packet with direct identity proof | public profile API only; no stronger name packet in reviewed docs | `blocked` | medium | exact truck route, alias route, `/scout` | yes |
| `logoUrl` | `All Gas No Brakes Reloaded` | missing | owner-confirmed logo asset or Knight field packet with source file | missing; only social candidates exist | `prepare` | low | exact truck route, alias route, `/scout` | yes |
| `coverImageUrl` | `All Gas No Brakes Reloaded` | missing | owner-confirmed cover asset or Knight field packet with image provenance | missing | `prepare` | low | exact truck route, alias route | yes |
| `websiteUrl` | `All Gas No Brakes Reloaded` | missing | owner-confirmed website URL or Knight packet with owner-linked destination | blocked by absent verified site evidence | `prepare` | low | exact truck route, alias route | yes |
| `instagramUrl` / `facebookPageUrl` | `All Gas No Brakes Reloaded` | missing | owner-confirmed social URLs or Knight packet that confirms ownership and exact canonical URL | public-source candidates only from throttled snippets | `prepare` | low | exact truck route, alias route, `/claim-truck` | yes |
| `menuUrl` | `All Gas No Brakes Reloaded` | missing | owner-confirmed menu destination | no reliable menu source in reviewed docs | `prepare` | low | exact truck route, alias route | yes |
| structured menu | `All Gas No Brakes Reloaded` | missing | owner-confirmed menu export or Knight packet with item-level approval | missing | `prepare` | low | exact truck route, alias route | yes |
| public schedule rows | `All Gas No Brakes Reloaded` | `No schedule posted` truthful today | owner-confirmed current dated schedule or Knight packet with dated artifact | candidate-only snippets with `TODAY ONLY` style ambiguity | `prepare` | high | exact truck route, alias route, downstream `/food-trucks-today/:city` | yes |
| live stop address | `All Gas No Brakes Reloaded` | unknown | owner-confirmed current stop address with date | missing | `prepare` | high | exact truck route, `/map` downstream | yes |
| map coordinates | `All Gas No Brakes Reloaded` | unavailable | geocode of owner-confirmed stop address | blocked until stop truth exists | `blocked` | high | `/map` downstream | yes |
| profile copy | `All Gas No Brakes Reloaded` | thin honest state only | owner-confirmed copy or Knight packet with source attribution | missing | `prepare` | medium | exact truck route, alias route | yes |
| `displayName` | `CREATIVBOWLS` | live and stable in production | stronger identity proof only if a later change is proposed | production value plus owned-site match supports current identity | `apply later` | high | exact truck route, alias route, `/scout` | yes |
| `logoUrl` | `CREATIVBOWLS` | missing in production | owner-confirmed logo asset or Knight owner-style packet approving owned-site logo | owned site and Instagram provide sourced candidate only | `prepare` | low | exact truck route, alias route, `/scout` | yes |
| `coverImageUrl` | `CREATIVBOWLS` | missing in production | owner-confirmed cover asset or Knight owner-style packet approving owned-site image | owned site provides sourced candidate only | `prepare` | low | exact truck route, alias route | yes |
| `websiteUrl` | `CREATIVBOWLS` | already live in production | stronger evidence only if replacement is proposed | verified production field and owned-site match align | `apply later` | high | exact truck route, alias route | yes |
| `instagramUrl` | `CREATIVBOWLS` | already live in production | stronger evidence only if normalization or replacement is proposed | verified production field | `apply later` | high | exact truck route, alias route | yes |
| `facebookPageUrl` | `CREATIVBOWLS` | missing | owner-confirmed canonical Facebook URL or Knight owner-style packet resolving candidate page | public-source candidate only; throttled open | `prepare` | low | exact truck route, alias route | yes |
| `menuUrl` | `CREATIVBOWLS` | missing in production | owner-confirmed menu destination or Knight owner-style packet approving owned-site menu path | owned site provides sourced candidate only | `prepare` | low | exact truck route, alias route | yes |
| structured menu | `CREATIVBOWLS` | missing in production | owner-confirmed menu export or Knight packet with exact approved sections/items | owned site shows menu sections, but not owner-approved import truth | `prepare` | low | exact truck route, alias route | yes |
| public schedule rows | `CREATIVBOWLS` | `No schedule posted` truthful today | owner-confirmed current dated schedule or Knight packet with explicit current window | owned site only hints at schedule process; no current posted schedule | `prepare` | high | exact truck route, alias route, downstream `/food-trucks-today/:city` | yes |
| live stop address | `CREATIVBOWLS` | no map-safe current stop | owner-confirmed current stop address with date | schedule-process clue only | `prepare` | high | exact truck route, `/map` downstream | yes |
| map coordinates | `CREATIVBOWLS` | unavailable | geocode of owner-confirmed stop address | blocked until stop truth exists | `blocked` | high | `/map` downstream | yes |
| profile copy | `CREATIVBOWLS` | sparse public profile | owner-confirmed copy or Knight packet using owned-site wording with explicit approval | owned site has descriptive copy but not approval-to-apply | `prepare` | medium | exact truck route, alias route | yes |
| `displayName` | `Jays Southern Cuisine` | protected verified field after whitespace-only hygiene apply | owner-confirmed rename or Knight packet with explicit identity resolution | current value protected; Big Jay's candidate is ambiguous | `blocked` | high | exact truck route, alias route, `/scout` | yes |
| `logoUrl` | `Jays Southern Cuisine` | missing | owner-confirmed logo asset or Knight owner-style packet | missing | `prepare` | low | exact truck route, alias route, `/scout` | yes |
| `coverImageUrl` | `Jays Southern Cuisine` | missing | owner-confirmed cover asset or Knight owner-style packet | missing | `prepare` | low | exact truck route, alias route | yes |
| `websiteUrl` | `Jays Southern Cuisine` | missing | owner-confirmed website URL or Knight packet with exact canonical site | missing | `prepare` | low | exact truck route, alias route | yes |
| `instagramUrl` / `facebookPageUrl` | `Jays Southern Cuisine` | missing | owner-confirmed canonical social URLs or Knight packet resolving identity match | low-confidence Big Jay's Facebook candidate only | `prepare` | high | exact truck route, alias route, `/claim-truck` | yes |
| `menuUrl` | `Jays Southern Cuisine` | missing | owner-confirmed menu destination | missing | `prepare` | low | exact truck route, alias route | yes |
| structured menu | `Jays Southern Cuisine` | missing | owner-confirmed menu export or Knight packet with item approval | missing | `prepare` | low | exact truck route, alias route | yes |
| public schedule rows | `Jays Southern Cuisine` | `No schedule posted` truthful today | owner-confirmed current dated schedule or Knight packet with dated artifact | missing; no safe schedule evidence in reviewed docs | `prepare` | high | exact truck route, alias route, downstream `/food-trucks-today/:city` | yes |
| live stop address | `Jays Southern Cuisine` | unknown | owner-confirmed current stop address with date | missing | `prepare` | high | exact truck route, `/map` downstream | yes |
| map coordinates | `Jays Southern Cuisine` | unavailable | geocode of owner-confirmed stop address | blocked until stop truth exists | `blocked` | high | `/map` downstream | yes |
| profile copy | `Jays Southern Cuisine` | thin honest state only | owner-confirmed copy or Knight packet with direct attribution | missing | `prepare` | medium | exact truck route, alias route | yes |

Matrix summary:

- `All Gas No Brakes Reloaded`: everything stays in `prepare` or `blocked`; nothing is ready for direct apply.
- `CREATIVBOWLS`: identity assets are best-positioned for a future narrow apply because owned-site evidence exists, but owner/Knight confirmation is still required.
- `Jays Southern Cuisine`: preserve the cleaned display name and block identity merges until the Big Jay's ambiguity is resolved.

## 8. Geocode and map eligibility rules

Map eligibility requires all of the following:

1. a current stop or event location tied to a date or date window
2. source evidence at `owner-confirmed` or strong `Knight-provided owner-style update` level
3. a geocoded coordinate pair derived from that exact stop address
4. no conflict between the stop artifact and the current public route truth

Geocode rules for the priority three:

| Truck | Current location truth | Geocode eligibility | Map eligibility result |
| --- | --- | --- | --- |
| `All Gas No Brakes Reloaded` | no verified current stop in repo docs | not eligible | blocked |
| `CREATIVBOWLS` | owned-site schedule-process clues only; no current map-safe stop | not eligible | blocked |
| `Jays Southern Cuisine` | no verified current stop in repo docs | not eligible | blocked |

Map doctrine:

- no static address, mailing address, or vague city reference may be promoted to live map truth
- no social snippet with `today only` wording may create map eligibility without dated confirmation
- geocode happens after stop truth is confirmed, not before

## 9. Menu and schedule currentness rules

Menu rules:

- `menuUrl` can be prepared from stronger evidence than structured menu rows, but it still needs direct confirmation before apply when the destination is not already verified in production
- structured menu rows require item-level owner/Knight approval or an approved import artifact
- public menu evidence from owned sites may support `prepare`, but it may not imply full menu completeness

Schedule rules:

- `current_week_only`: use only when the artifact is explicitly dated to the present week
- `recurring`: use only when the artifact explicitly states a repeating cadence
- `needs_owner_confirmation`: use when a schedule seems plausible but the date, recurrence, or ownership link is not strong enough
- `No schedule posted`: preserve when none of the above are satisfied

Priority-three currentness result:

| Truck | Menu currentness rule | Schedule currentness rule |
| --- | --- | --- |
| `All Gas No Brakes Reloaded` | keep `Menu unavailable right now.` until owner-confirmed menu evidence exists | keep `No schedule posted` until dated owner/Knight schedule evidence exists |
| `CREATIVBOWLS` | owned-site menu can support prep only; do not imply imported or complete menu coverage | keep `No schedule posted`; weekly schedule process notes are not current schedule truth |
| `Jays Southern Cuisine` | keep `Menu unavailable right now.` until owner-confirmed menu evidence exists | keep `No schedule posted` until dated owner/Knight schedule evidence exists |

## 10. Public route smoke plan

Every future apply lane for the priority three must smoke these exact routes before and after apply:

Shared routes:

- `https://www.mealscout.us/scout`
- `https://www.mealscout.us/claim-truck`
- `https://www.mealscout.us/restaurant-signup?businessType=food_truck`

Truck routes:

| Truck | Canonical route | Alias route |
| --- | --- | --- |
| `All Gas No Brakes Reloaded` | `https://www.mealscout.us/truck/all-gas-no-brakes-reloaded--6ca08365-f8af-4c1d-9754-6c998c803869` | `https://www.mealscout.us/p/truck/6ca08365-f8af-4c1d-9754-6c998c803869` |
| `CREATIVBOWLS` | `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb` |
| `Jays Southern Cuisine` | `https://www.mealscout.us/truck/jays-southern-cuisine--96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2` | `https://www.mealscout.us/p/truck/96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2` |

Smoke assertions:

- route loads without crash
- truck name is not corrupted
- hero fallback or applied asset matches intended field scope
- menu truth label remains honest
- schedule truth label remains honest
- social and website links are either correct or absent
- claim/update path remains visible
- no route alias divergence changes the observed truth

Downstream route note:

- `/food-trucks-today/:city` and `/map` remain downstream trust surfaces, not the first apply smoke surface for the priority three
- exact city-route smoke should be added only after the city token is confirmed from runtime evidence for the chosen truck and field change

## 11. Blocked fields and why

Globally blocked until stronger evidence exists:

- all public schedule rows for the priority three
- all map coordinates for the priority three
- all live stop addresses for the priority three
- all menu imports for `All Gas No Brakes Reloaded` and `Jays Southern Cuisine`
- any `Big Jay's` identity merge into `Jays Southern Cuisine`
- any social URL apply for `All Gas No Brakes Reloaded` or `Jays Southern Cuisine` based on public snippets alone

Truck-specific blocked calls:

| Truck | Blocked field or action | Why blocked |
| --- | --- | --- |
| `All Gas No Brakes Reloaded` | any direct social/menu/schedule/location apply | evidence is snippet-based and owner confirmation is absent |
| `CREATIVBOWLS` | schedule or map apply | owned-site evidence shows process, not current stop truth |
| `Jays Southern Cuisine` | Big Jay's Facebook candidate merge | identity is ambiguous and conflicts with protected current name truth |

## 12. Exact next apply slice

Recommended first apply slice after this prep lane merges:

`CREATIVBOWLS identity asset slice: apply logo only`

Why this is the safest first real slice:

- it is one truck
- it is one visible trust improvement
- the current profile is thin enough for the improvement to matter
- the owned site already provides candidate identity evidence
- it avoids menu, schedule, location, and ambiguous-social risk on the first apply pass

Required preconditions:

1. capture the exact owned-site logo artifact in a review packet
2. record either `owner-confirmed` approval or a strong `Knight-provided owner-style update` that explicitly approves logo apply
3. confirm no competing logo asset exists in current production
4. run exact-route smoke on `/scout`, the canonical truck route, and the alias route before and after apply

What must remain out of that first apply slice:

- cover image apply
- website replacement
- Instagram replacement
- Facebook apply
- menu URL apply
- structured menu apply
- schedule apply
- live location or geocode apply
- profile copy expansion

Scope confirmation:

- No runtime code changed in this packet.
- No schema changed in this packet.
- No production data changed in this packet.
- No map or live-feed behavior changed in this packet.
- No B2/internal intake behavior changed in this packet.
- No admin claiming flow changed in this packet.
- No import tooling changed in this packet.
