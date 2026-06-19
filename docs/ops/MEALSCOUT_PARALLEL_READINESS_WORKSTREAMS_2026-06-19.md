Status: `parallel readiness control packet`

# MealScout Parallel Readiness Workstreams — 2026-06-19

## Decision

PR `#125` is complete and live.

Current production baseline:

- `main` SHA: `9fddf8a6cb5e263a547e1af80f008e480ae968f1`
- posture: limited live exposure
- posture does **not** equal full-app readiness

Known completed and preserved:

- public signup legal gate
- schedule-state truth on the five smoked truck profiles
- `/api/version` platform-aware metadata
- bot/prerender public profile intake routing
- `P1` exposure guardrails
- operator-safe share packet
- `request_logs` active
- `telemetryEvents` active

## Operating Rule

Run all five lanes in parallel, but do not let one lane make claims for another.

Do not:

- claim the full app is ready
- turn one bug into a rebuild
- mix content completion with route hardening
- mix real-user triage with theoretical audits
- ship broad claims from narrow proof
- reopen cleared blockers without live regression evidence

## Shared Constraints

- No runtime code changes in this control document.
- No production data changes in this control document.
- No schema changes in this control document.
- No invented user feedback, metrics, or operator evidence.
- No lane should widen scope by itself into a whole-app redesign.

## Coordination Model

Each lane owns a different question:

- Surface Inventory: what is reachable and how risky is it?
- Real User Friction: what are real people actually hitting?
- Truck Content Completion: which visible truck profiles feel incomplete?
- Owner Journey Hardening: where do owners get confused or dead-end?
- Patron Discovery: can a patron find something useful within the truck-first scope?

Each lane should publish its own outputs and handoffs.

## Lane 1: Surface Inventory

**Business goal**

Classify every reachable route as `Green`, `Yellow`, `Red`, or `Unknown`.

**Owner/user impact**

Operators need a current truth map before they share links, route traffic, or approve broader exposure.

**Current known state**

- high-level containment classification already exists
- truck-first verified surfaces are known safer than broad app navigation
- some route groups are still only partially classified

**What counts as blocker**

- a route with meaningful live traffic has no classification
- a route is being intentionally shared despite unclear or wrong classification
- a route is classified safely but live behavior proves otherwise

**What counts as normal work**

- route discovery
- route grouping
- risk labeling
- identifying unknown surfaces for later audit

**Allowed changes**

- docs
- route maps
- classification matrices
- audit packets

**Forbidden changes**

- runtime rewrites framed as "inventory"
- schema changes
- production data edits
- broad UX redesign

**Validation required**

- every reachable route placed into one of the four classes
- classification rationale written for each major surface family
- explicit note where evidence is live-proven vs inferred from source

**Next output expected**

A route map and risk classification packet covering public, guest, owner-continuation, transactional, and operator-adjacent surfaces.

## Lane 2: Real User Friction

**Business goal**

Capture actual problems real people hit and rank them by user harm and frequency.

**Owner/user impact**

This lane prevents theoretical debate from outranking real user pain.

**Current known state**

- real people are already touching MealScout
- `request_logs` and `telemetryEvents` are active
- recent containment work reduced exposure but did not eliminate friction

**What counts as blocker**

- repeated user-facing breakage on a live shared surface
- dead-end or misleading flows causing abandonment
- trust-damaging errors, blank states, or false product promises on active surfaces

**What counts as normal work**

- issue intake
- grouping duplicate reports
- ranking by harm and recurrence
- separating blocker, annoyance, and content gap

**Allowed changes**

- triage docs
- ranked issue queues
- evidence packets
- operator reporting templates

**Forbidden changes**

- inventing user complaints
- mixing hypothetical risk with confirmed user friction
- reclassifying content incompleteness as runtime breakage without proof

**Validation required**

- every item tied to real evidence such as logs, screenshots, timestamps, or reproducible route reports
- each issue ranked by harm and frequency
- clear separation between blocker, normal defect, and content gap

**Next output expected**

A ranked live-user triage queue with evidence-backed severity and frequency labels.

## Lane 3: Truck Content Completion

**Business goal**

Make visible truck profiles feel real without inventing data.

**Owner/user impact**

Better truck content improves trust on the currently exposed public surfaces without pretending the broader app is complete.

**Current known state**

- several live truck profiles still have thin menus, empty schedules, sparse imagery, or incomplete metadata
- the five smoked profiles are truth-safe but not content-complete
- honest missing-state copy must stay intact

**What counts as blocker**

- content creates deception
- missing or wrong content breaks a currently shared safe profile
- schedule or menu evidence is represented falsely

**What counts as normal work**

- logos
- covers
- menus
- schedules
- socials
- owner-approved business descriptions
- source review and evidence preparation

**Allowed changes**

- docs
- content gap trackers
- evidence packets
- review queues
- owner-approval packets

**Forbidden changes**

- invented menus
- invented schedules
- invented prices
- unapproved owner claims
- content work framed as route safety proof

**Validation required**

- every proposed content change tied to source evidence or owner approval
- missing data preserved honestly where proof is absent
- clear separation between sourced, applied, missing, and needs-owner-confirmation states

**Next output expected**

A truck content gap queue covering menus, schedules, logos, covers, socials, and owner notes for the visible live truck set.

## Lane 4: Owner Journey Hardening

**Business goal**

Verify owners can create a profile, claim a truck, and continue setup or verification without confusion.

**Owner/user impact**

This lane protects the operator and owner intake path that feeds better public profiles later.

**Current known state**

- signup legal gate is live and verified
- claim-truck and continuation routes exist but are still sensitive to state and context
- public sharing should stay on exact safe entry URLs, not later continuation routes

**What counts as blocker**

- owner cannot complete the intended create or claim entry path
- continuation links dead-end or confuse cold traffic
- verification/setup state becomes misleading or unusable

**What counts as normal work**

- journey mapping
- continuation-state review
- copy clarity
- account-state classification
- narrow dead-end fixes

**Allowed changes**

- docs
- journey maps
- blocker lists
- state diagrams
- narrow fix proposals

**Forbidden changes**

- reopening cleared signup/legal gate work without live regression proof
- changing schema under a journey-hardening banner
- using owner journey work to justify broad launch

**Validation required**

- every owner state mapped from entry to next step
- create, claim, verification, and continuation paths separated clearly
- blockers backed by reproducible route evidence

**Next output expected**

An owner journey map with blocker inventory, account-state taxonomy, and the next narrow-fix lane.

## Lane 5: Patron Discovery

**Business goal**

Make Scout useful inside the current truck-first early-access scope.

**Owner/user impact**

Patrons need to find something worth eating without being pushed into dead ends or over-promised product areas.

**Current known state**

- Scout is live with containment guardrails
- Scout now signals early access and keeps guest header actions contained
- broader restaurant, event, deal, and transactional readiness is still unproven

**What counts as blocker**

- patrons cannot discover useful truck content on shared discovery surfaces
- discovery paths repeatedly dump users into off-scope or misleading destinations
- live discovery surfaces imply broader readiness than exists

**What counts as normal work**

- discovery friction review
- dead-end analysis
- truck-first usefulness ranking
- contained search and map review
- next-step improvement proposals

**Allowed changes**

- docs
- discovery audits
- friction lists
- read-only smoke evidence
- narrow improvement proposals

**Forbidden changes**

- Scout rebuild plans presented as immediate work
- broad redesign
- restaurant-surface readiness claims without separate proof
- mixing discovery usefulness with content ingestion work

**Validation required**

- friction items tied to actual live flows
- clear distinction between useful, confusing, and misleading discovery steps
- next-step improvements remain truck-first and narrow

**Next output expected**

A patron discovery friction list and the next narrow improvement lane for Scout usefulness inside early access.

## Sequencing Rule

Parallel does not mean merged scope.

- Surface Inventory defines the map.
- Real User Friction defines what hurts now.
- Truck Content Completion improves truthful visible profiles.
- Owner Journey Hardening improves owner intake and continuation.
- Patron Discovery improves usefulness within the contained truck-first surface.

Each lane may inform the others, but no lane may absorb the others.

## Reporting Rule

Every lane output should answer:

- what changed in understanding
- what was proven
- what remains unproven
- what the next narrow step is

## Scope Confirmation

- No runtime code changed in this document lane.
- No production data changed in this document lane.
- No schema changed in this document lane.
- No cleared blockers were reopened without live regression evidence.
