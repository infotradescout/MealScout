# MealScout UI Recovery - Design Jail

Date: 2026-06-30
Repo: `infotradescout/MealScout`
Base SHA: `7406ac29358ee4f8f0da0c7d6c45d10b44a4f99d`
Purpose: stop AI-generated pitch-deck UI from entering MealScout and force route work into approved app primitives only.

## Decision

MealScout UI surface work is frozen until route changes are constrained to a small approved app system.

This is not a copy problem alone. It is an implementation control problem:

1. Open-ended prompts let Codex invent new visual systems.
2. Scope/tests can pass while the route still looks unlike a real food app.
3. Screenshot review happens too late, after branch churn and trust loss.

The fix is design jail, not another freeform "surface rescue."

## Approved App Primitives

Codex may assemble UI only from this approved set:

- `AppShell`
- `TopNav`
- `BottomNav`
- `SearchRow`
- `FilterRow`
- `SectionHeader`
- `FoodCard`
- `TruckCard`
- `RestaurantCard`
- `DishCard`
- `DealCard`
- `EmptyState`
- `LoadingState`
- `ErrorState`
- `HorizontalRail`
- `MapListToggle`
- `PlainCTA`

If a needed primitive does not exist, the work stops and a primitive proposal must be approved first. Route work may not invent a substitute inline.

## Forbidden UI Patterns

The following patterns are banned unless explicitly approved in advance:

- hero sections
- landing-page headers
- giant display headlines
- pitch-deck copy
- brand slogans
- abstract page intros
- decorative marketing blocks
- compressed decorative typography
- fake popularity language
- fake activity language
- fake momentum language
- vague "pulse", "gravity", "catching fire", or "city hungry" copy
- route-specific one-off card designs
- route-specific one-off headline treatments
- route-specific one-off shell layouts

## Forbidden Implementation Behavior

- Codex may not invent a new visual system.
- Codex may not introduce a new hero or hero-adjacent header pattern.
- Codex may not add clever product copy.
- Codex may not create route-specific decorative layouts.
- Codex may not mark a UI route ready without screenshots.
- Gawain may not approve a UI PR without screenshots and primitive compliance.

## Route Assembly Rule

Route work is assembly only:

- `/trending` = `AppShell` + compact title + `SectionHeader` + cards + `EmptyState`
- `/scout` = `AppShell` + `SearchRow` + `MapListToggle` + cards + rails
- `/map` = `AppShell` + map + list + recovery actions
- `/user-dashboard` = `AppShell` + saved/recent/nearby/action sections

Any prompt that asks Codex to "improve", "polish", "rescue", or "make it food-first" is invalid. Those prompt shapes are now banned.

## Required UI PR Packet

Every UI PR must include:

- route touched
- existing screenshot
- target screenshot
- mobile screenshot after change
- desktop screenshot after change
- list of primitives used
- banned phrase check
- broken image check
- no fake data or fake popularity check
- no horizontal overflow check
- exact changed files
- confirmation that no unapproved new primitive was introduced

If any item is missing, the PR is blocked.

## Screenshot Gate

No UI route may be called ready, merge-safe, or production-good without:

1. mobile screenshot
2. desktop screenshot
3. broken-image review
4. overflow review
5. primitive compliance review

## Banned Prompt Shapes

Invalid:

- "Improve /trending."
- "Make /scout better."
- "Polish the route."
- "Make it food-first."

Valid:

- "Use existing `AppShell`, `SectionHeader`, `DishCard`, and `EmptyState`."
- "No new visual primitives."
- "No hero."
- "No marketing copy."
- "Return mobile and desktop screenshots before PR."

## Branch Freeze Status

Until primitive jail is active:

- stop AI-led visual route work
- allow only bug, security, and data correctness fixes
- block new route redesign attempts
- block merge of UI work that lacks screenshots

## Current Operational Rules

1. Branches with unreviewed visual churn do not merge.
2. Merged UI work can still be classified as damaged if screenshots or primitive compliance are missing.
3. If a route needs a new visual idea, stop and propose a primitive first.
4. If a route only needs clearer assembly, reuse approved primitives and keep copy literal.

## Missing Governance That Must Exist Before More UI Work

- a primitive checklist attached to every UI PR
- a banned-phrase contract for high-risk public routes
- screenshot evidence stored with PR review
- a branch freeze label for UI work that lacks screenshot proof
- a route inventory with keep/fix/revert/park verdicts

## Next Safest Execution Order

1. Freeze current AI-led surface work.
2. Review the route damage inventory.
3. Choose the canonical primitive set already present in the app.
4. Build any missing primitives once, outside route redesign work.
5. Reassemble one route at a time, starting with the highest-risk public surface.
6. Require screenshots before PR approval.
