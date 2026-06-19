Status: `parallel lane kickoff packet`

# MealScout Parallel Lane Kickoff Packet — 2026-06-19

## Purpose

Start the five parallel MealScout readiness lanes from the remote control-tower baseline without scope bleed.

Current `main` baseline:

- `e19033e34a3bb4e32b6c81a7acc7d8704dbf4f48`

Inputs used:

- `docs/ops/MEALSCOUT_PARALLEL_READINESS_WORKSTREAMS_2026-06-19.md`
- `docs/ops/MEALSCOUT_LIVE_EXPOSURE_SURFACE_CONTAINMENT_AUDIT_2026-06-19.md`
- `docs/ops/MEALSCOUT_OPERATOR_SAFE_LINK_PACKET_2026-06-19.md`

## Global Ground Rules

- This kickoff packet is docs-only.
- No runtime code changes.
- No production data changes.
- No schema changes.
- No claim of full-app readiness.
- No merging the five lanes into one broad rebuild.
- No invented user feedback, metrics, or content.
- No reopening cleared blockers without live regression evidence.

## Current Shared Truth

Known completed and preserved:

- public signup legal gate
- schedule-state truth on the smoked truck profile subset
- `/api/version` platform-aware metadata
- bot/prerender public profile intake routing
- `P1` exposure guardrails
- operator-safe share packet
- `request_logs` active
- `telemetryEvents` active

Still true:

- MealScout is live in limited form
- full-app readiness is not proven
- most surfaces remain only partially validated
- the five lanes now need evidence-first outputs before broader claims

## Queue 1: Surface Inventory

**Objective**

Classify every reachable route as `Green`, `Yellow`, `Red`, or `Unknown`.

**Current known state**

- the containment audit already classifies major public surfaces at a high level
- exact truck-signup entry, selected truck profiles, and limited truck discovery are safer than broad app-wide navigation
- many secondary and continuation surfaces remain unclassified or only partially classified

**Evidence required**

- route list from source and route maps
- route grouping by public, guest, owner-continuation, transactional, and operator-adjacent families
- current containment class and rationale for each route family
- explicit note when a classification is live-proven vs source-inferred

**What counts as blocker**

- a reachable route with meaningful live exposure has no classification
- a route is actively shared even though its risk class is unknown or wrong
- live behavior disproves the documented class for a route already in circulation

**What does not count as blocker**

- a route is ugly but honestly labeled
- a route is incomplete but not actively exposed
- a route is low-priority and still marked `Unknown` while not intentionally shared

**First inspection targets**

- `client/src/App.tsx`
- `MEALSCOUT_ROUTE_MAP.md`
- public and guest routes in the containment audit
- continuation and transactional routes:
  - `/account-setup`
  - `/owner/verify`
  - `/post-verification`
  - `/menu/:restaurantId`
  - `/checkout/:restaurantId`
  - `/order-confirmation/:orderId`
- operator-adjacent public entries:
  - `/deal-creation`
  - `/admin`
  - `/parking-pass`

**Output format**

A route inventory table with:

- route or route family
- current promise
- observed behavior source
- class: `Green` / `Yellow` / `Red` / `Unknown`
- rationale
- share status: allowed / supervised / do not share / unresolved

**Next decision gate**

Proceed to narrow route-hardening only when route classes and share-status gaps are explicit enough to prioritize one contained fix lane.

## Queue 2: Real User Friction

**Objective**

Build a ranked queue from actual people and telemetry only.

**Current known state**

- real people are already touching MealScout
- `request_logs` and `telemetryEvents` are active
- the app is still broad enough that live friction can appear outside the current safe core

**Evidence required**

- real user reports with route, timestamp, screenshot, or operator notes
- `request_logs` evidence for affected routes
- `telemetryEvents` evidence for repeated abandonment or failed interactions
- reproducible route notes only when tied back to real traffic or reports

**What counts as blocker**

- repeated live-user breakage on an intentionally shared surface
- dead-end or misleading flow that causes real abandonment
- trust-damaging blank/error behavior on active public or owner-entry routes

**What does not count as blocker**

- theoretical friction with no real evidence
- content thinness by itself
- old issues already bounded by containment unless fresh regression evidence exists

**First inspection targets**

- shared patron entries:
  - `/scout`
  - `/map`
  - smoked truck profile subset
- shared owner entries:
  - `/restaurant-signup?businessType=food_truck`
  - `/claim-truck`
- `request_logs`
- `telemetryEvents`
- operator issue packets and screenshots when available

**Output format**

A ranked triage queue with:

- issue label
- affected route
- user type
- harm level
- frequency signal
- evidence links or references
- blocker vs normal defect vs content gap

**Next decision gate**

Escalate to a fix lane only when an item has real evidence and ranks as `P0` or `P1` by harm plus recurrence.

## Queue 3: Truck Content Completion

**Objective**

Create a six-truck content gap board that makes visible truck profiles feel real without inventing data.

**Current known state**

- the five smoked truck profiles are trust-safe on schedule truth but still thin in places
- the recent hardening summary names six visible active trucks:
  - `3D Eats & Tea`
  - `Blessed Berry Bowls`
  - `Sweet Love`
  - `All Gas No Brakes Reloaded`
  - `CREATIVBOWLS`
  - `Jays Southern Cuisine`
- content completion is onboarding work, not proof of route readiness

**Evidence required**

- current live profile state for each visible truck
- source-backed status for menu, schedule, logo, cover, socials, and owner-approved details
- explicit source state: missing / sourced / applied / needs owner confirmation
- note where honest empty-state copy is currently carrying the profile

**What counts as blocker**

- content or metadata creates deception on a currently shared truck profile
- verified safe profile is missing or misrepresenting source-backed schedule/menu truth
- a shared truck profile is broken enough to undermine current limited live exposure

**What does not count as blocker**

- sparse but honest profile state
- missing logo or cover by itself
- absent menu rows when the page truthfully says menu data is partial or unavailable

**First inspection targets**

- six visible active truck profiles from the hardening summary
- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`
- public-profile live pages for:
  - menu truth
  - schedule truth
  - logo/cover presence
  - social link presence

**Output format**

A six-truck content gap board with columns:

- truck
- route
- menu status
- schedule status
- logo status
- cover status
- socials status
- owner-note status
- evidence status
- blocker or normal completion work

**Next decision gate**

Move to content-application planning only after each gap is labeled with real source status and owner-confirmation needs.

## Queue 4: Owner Journey Hardening

**Objective**

Map create, claim, and setup continuation routes and identify owner blockers.

**Current known state**

- the public signup legal gate is live and verified
- claim-truck is a yellow supervised surface
- continuation and verification routes exist but are not public share destinations
- owner journey readiness is narrower than app-wide readiness

**Evidence required**

- route map for create, claim, verification, and continuation states
- exact entry and next-step behavior for:
  - `/restaurant-signup?businessType=food_truck`
  - `/claim-truck`
  - `/account-setup`
  - `/owner/verify`
  - `/post-verification`
- known live proofs or regressions tied to these routes
- stateful branch notes for authenticated vs unauthenticated owners

**What counts as blocker**

- owner cannot complete the intended create or claim entry
- continuation route dead-ends or misroutes real users
- setup or verification state becomes misleading or unusable in a live owner journey

**What does not count as blocker**

- a continuation route is intentionally not safe for cold sharing
- incomplete downstream polish with no live confusion evidence
- owner content follow-up work that does not break the core path

**First inspection targets**

- `client/src/pages/restaurant-signup.tsx`
- `client/src/pages/claim-truck.tsx`
- `client/src/pages/account-setup.tsx`
- `client/src/pages/post-verification.tsx`
- `MEALSCOUT_AUTH_ONBOARDING_ALIGNMENT_AUDIT.md`
- `MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md`

**Output format**

An owner route map with:

- route
- intended user state
- current behavior
- continuation dependency
- blocker status
- proof source

**Next decision gate**

Open a narrow owner-fix lane only when a reproducible blocker exists on create, claim, or verified continuation behavior.

## Queue 5: Patron Discovery

**Objective**

Produce a Scout usefulness audit inside the current truck-first early-access scope.

**Current known state**

- Scout is live with containment guardrails
- Scout now signals early access and contains guest actions and search
- `/map` is still yellow and broader than the verified truck core
- restaurant, ordering, events, deals, video, and other broader discovery promises remain unproven

**Evidence required**

- live read-only walkthroughs of:
  - `/scout`
  - `/map`
  - smoked truck profiles
  - general public truck profile subset
- contained search behavior notes
- discovery dead-end notes tied to actual route flows
- evidence of whether a patron can find something worth eating without leaving the truck-first scope

**What counts as blocker**

- patron discovery repeatedly routes users into misleading or off-scope destinations
- the truck-first discovery surface fails to produce useful results on shared live flows
- a current discovery surface overstates readiness in a way that harms user trust

**What does not count as blocker**

- the full app is not yet broad enough to cover every discovery need
- a truck profile is thin but honest
- yellow-surface incompleteness already disclosed by early-access framing

**First inspection targets**

- `/scout`
- `/map`
- `client/src/pages/scout-prototype.tsx`
- `client/src/pages/map.tsx`
- operator-safe share packet routes
- smoked truck profile subset

**Output format**

A Scout usefulness audit with sections for:

- useful discovery paths
- confusing paths
- dead ends or trust risks
- contained behavior that should be preserved
- next narrow discovery-improvement candidate

**Next decision gate**

Only open a patron-discovery improvement lane once the audit shows a contained, truck-first improvement that does not widen scope into a Scout rebuild.

## First Output Rule

The first output from each queue should be evidence-only unless a real `P0` or `P1` appears.

That means:

- inventory before hardening
- live-user proof before bug ranking
- source-backed gap boards before content application
- route maps before owner-flow rewrites
- usefulness audit before discovery redesign

## Scope Confirmation

- No runtime code changed in this kickoff packet.
- No production data changed in this kickoff packet.
- No schema changed in this kickoff packet.
- No cleared blockers were reopened without live regression evidence.
