# MealScout Surface Damage Inventory

Date: 2026-06-30
Repo: `infotradescout/MealScout`
Base SHA: `7406ac29358ee4f8f0da0c7d6c45d10b44a4f99d`
Inventory scope: current `main`, named local branches, and live-facing route code visible from the repo.

## Method

This inventory is code-based, not screenshot-based. Where screenshot proof was not present in the repo or current lane context, screenshot columns are marked `No`.

Named branch notes:

- `codex/mealscout-trending-surface-ux-rescue-v1` head: `a8fb8e6b597aa461d387f3e2fc20ec1ba017dbe3`
- `codex/mealscout-scout-market-label-responsive-polish` head: `13e3b2bfd56c5150d799e203074ed8b3740826e1`
- `13e3b2bfd56c5150d799e203074ed8b3740826e1` is already an ancestor of `main`
- `a8fb8e6b597aa461d387f3e2fc20ec1ba017dbe3` is not merged to `main`

## Inventory

| Route / branch | Current source | Current verdict | Violation type | Hero / header / pitch-deck pattern? | Fake popularity / momentum language? | Images / fallbacks clean? | Mobile screenshot exists? | Desktop screenshot exists? | Understandable in 3 seconds? | Recommended action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/scout` | `main` + live-facing route in `client/src/pages/explore-preview.tsx` | FIX | One-off shell, atmospheric hero behavior, screenshot debt, fallback inconsistency still open in local follow-up lane | Yes | No clear fake momentum copy on current main, but route still uses custom scene logic instead of primitive assembly | Partial | No | No | Partial | Freeze new polish. Keep data fixes only. Rebuild later from primitives after screenshot review. | P1 |
| `/map` | `main` | NEEDS SCREENSHOT | Complex custom route, high interaction density, no screenshot proof in this lane | No obvious marketing hero | No | Partial / N-A | No | No | Partial | Keep route stable. Require mobile and desktop screenshots before any visual edits. | P2 |
| `/trending` | `main` + live-facing route in `client/src/pages/trending.tsx` | REVERT | Overdesigned hero, banned copy, fake momentum language, unreadable mobile headline risk | Yes | Yes | Partial | No | No | No | Do not patch by "polish." Replace with primitive-only assembly after design jail is active. | P0 |
| `/user-dashboard` | `main` | FIX | Branded one-off header language and route-specific shell treatment | Yes, mild branded header | No | Unknown | No | No | Partial | Reduce to app-shell sections only after primitive inventory is locked. | P2 |
| `/search` | `main` | KEEP | No immediate pitch-deck issue found in route entry; still lacks screenshot proof | No obvious hero | No | Unknown | No | No | Yes | Keep current structure. Add screenshots before any UI claims of readiness. | P3 |
| `/deals` | `main` (`/deals`, `/deals/featured`, `/deals/:city`) | NEEDS SCREENSHOT | Functional route, but mixed card/ad presentation and no screenshot proof | No | No | Partial | No | No | Partial | Screenshot current mobile and desktop before deciding keep vs fix. | P3 |
| `/favorites` | `main` | KEEP | Mostly standard app layout; minor marketing copy in "Pro Tip" block only | No | No | Yes enough from code path | No | No | Yes | Keep. Remove any non-essential promo block only if later screenshot review shows clutter. | P3 |
| `/restaurants` | No standalone route on `main`; closest surfaces are search results and public restaurant profiles | PARK | Route concept not implemented as a separate app surface | N-A | N-A | N-A | No | No | N-A | Do not invent a new `/restaurants` surface during freeze. Use search and public profiles only. | P3 |
| `/food-trucks` | `main` (`/truck-discovery`, `/food-trucks/:citySlug`, `/food-trucks/:citySlug/:cuisineSlug`) | NEEDS SCREENSHOT | Multiple overlapping truck surfaces, no screenshot packet, unclear primitive compliance | No obvious pitch-deck hero in `truck-discovery`; city pages not reviewed visually | No obvious fake momentum copy in reviewed file | Partial | No | No | Partial | Inventory these pages with screenshots before any redesign or consolidation. | P2 |
| Public truck profiles | `main` via `client/src/pages/public-profile.tsx` and elevated truck hero components | FIX | Multiple hero variants and one-off profile presentation patterns | Yes | No | Partial | No | No | Partial | Replace hero-first custom treatment with approved profile primitives later. | P1 |
| Public restaurant profiles | `main` via `client/src/pages/public-profile.tsx` and elevated restaurant hero components | FIX | Multiple hero variants and one-off profile presentation patterns | Yes | No | Partial | No | No | Partial | Same as truck profiles: move to primitive-only profile assembly. | P1 |
| Login / signup / customer onboarding | `main` (`/login`, `/customer-signup`, `/restaurant-signup`, `/host-signup`) | FIX | Inconsistent route-specific onboarding treatments; some signup flows still use hero framing or brand-heavy wrappers | Yes on some signup routes | No | Unknown | No | No | Partial | Keep functional auth behavior, but freeze visual work until primitives are locked. | P2 |
| `codex/mealscout-trending-surface-ux-rescue-v1` | local branch | PARK | Branch contains the rejected `/trending` direction and cross-route churn including nav and scout files | Yes | Yes | Unknown | No | No | No | Do not push or merge. Leave blocked. | P0 |
| `codex/mealscout-scout-market-label-responsive-polish` | local branch ref; changes already merged into `main` | PARK | Branch ref is stale because the commit is already merged; live route still lacks screenshot-backed closure | Yes, route still sits inside custom Scout shell | No | Partial | No | No | Partial | Do not continue work from this branch ref. Use `main` only, and require screenshots before any follow-up UI PR. | P1 |

## Top-Level Conclusions

### 1. Merged changes currently safe to keep

- Same-origin location-context fix work is safe to keep.
- Scout first-fold rescue improvements that restored visible content are safe to keep.
- Scout market label clarification that replaced vague "Saved market" is safe to keep in principle, but live route still needs screenshot-backed follow-up because the branch ref is merged and visual closure is incomplete.

### 2. Active branches that must not be merged

- `codex/mealscout-trending-surface-ux-rescue-v1`
- any local `/trending` rewrite branch created after the rejected direction
- any Scout follow-up branch without screenshot proof of image fallback and overflow behavior

### 3. Surfaces that require screenshot review before any more work

- `/scout`
- `/map`
- `/deals`
- `/food-trucks`
- `/user-dashboard`
- public truck profiles
- public restaurant profiles
- login and signup flows

### 4. Surfaces that should be reverted instead of patched

- `/trending` should not receive more freeform patching. The current pattern should be replaced with primitive-only assembly, not continued with more route-level design churn.
- the blocked `/trending` branch should remain parked, not rehabilitated.

### 5. UI primitives missing or not yet enforced

- canonical `AppShell`
- canonical `SectionHeader`
- canonical empty, loading, and error states
- canonical food, truck, restaurant, dish, and deal cards
- canonical horizontal rail behavior
- canonical `MapListToggle`
- canonical `PlainCTA`
- primitive compliance checklist in PR review

### 6. Next safest execution order

1. Freeze AI-led UI route work.
2. Treat `/trending` as the first reset candidate because it has the clearest live copy violations.
3. Establish the approved primitive set in code and docs.
4. Take baseline mobile and desktop screenshots for `/scout`, `/map`, `/trending`, and `/user-dashboard`.
5. Reassemble one route at a time from primitives only.
6. Require screenshot packet compliance before any UI PR approval.

## Counts

- KEEP: 2
- FIX: 5
- REVERT: 1
- PARK: 3
- NEEDS SCREENSHOT: 3
