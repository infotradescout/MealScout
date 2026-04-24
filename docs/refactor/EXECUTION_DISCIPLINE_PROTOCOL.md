# MealScout Refactor Execution Discipline Protocol

Status: Active
Owner: Repo Owner
Last Updated: 2026-04-24

## Purpose

This protocol converts the current refactor from intent into enforced operating control.

Primary objective:
- Reduce risk in the three active hotspot seams while preserving production behavior.

Locked lanes for this protocol:
- Storage seam extraction
- Admin domain split
- Event domain split

Out of scope during this window:
- Net-new feature surfaces in these seams
- New monetization workflows in these seams
- Cross-domain schema redesign not required for active seam extraction

## Lane Lock

Only these lanes are allowed until this protocol is explicitly closed:

| Lane ID | Lane Name | Primary Hotspot | Current Risk Type |
| --- | --- | --- | --- |
| lane-storage | Storage seam extraction | server/storage.ts | Coupling, hidden behavior changes |
| lane-admin | Admin domain split | server/routes/adminManagementRoutes.ts | Policy drift, exception accumulation |
| lane-events | Event domain split | server/routes/eventRoutes.ts | Cross-cutting regression risk |

If a PR cannot map to one lane above, it waits.

## Required Ownership Per Slice

Each extraction slice must assign:
- One owner
- One reviewer
- One fallback owner

Minimum accountability fields per slice:
- Slice ID
- Lane ID
- Owner
- Reviewer
- Fallback owner
- Files touched
- Declared blast radius
- Rollback command or revert plan
- Verification evidence links

No owner and reviewer means no merge.

## Blast Radius Declaration (Mandatory)

Every PR must include this block:

- Lane ID:
- Slice ID:
- Files touched:
- Expected behavior to remain unchanged:
- Domains potentially impacted:
- User roles impacted:
- Revenue-critical flows impacted:
- Telemetry counters to watch:
- Rollback trigger threshold:
- Rollback action:

## Anti-Regression Contract (Mandatory)

Before merge and after deploy verification, parity must be validated for all impacted domains.

Required checks:
- npm run check
- npm run build
- npm run build:server
- npm run test:flows:with-server

Domain parity checklist:
- Auth and ownership checks produce same allow or deny outcomes
- Subscription gate returns same pass or blocked behavior for equivalent input
- Booking and event state transitions remain identical for core states
- Admin totals and telemetry counters remain within expected tolerance

Evidence location:
- docs/refactor/REFACTOR_METRICS_LOG.md
- docs/refactor/REFACTOR_BOARD.md

## Temporary Freeze Rule

Within active hotspot seams, only these change types are allowed:
- Refactor extraction moves
- Reliability fixes
- Observability hardening
- Compliance or security fixes

Blocked during freeze:
- New user-facing product capability in the same touched seams
- Unrelated behavior changes bundled with extraction

## Thin-Slice Shipping Rule

Each merge must be a bounded slice.

Slice limits:
- One lane per PR
- One dominant hotspot per PR
- One rollback unit per PR
- No mixed extraction plus feature work

Definition of done for a slice:
- Blast radius declared
- Checks passed
- Metrics before and after logged
- Rollback path documented
- Reviewer signoff captured

## Decision Standard (Ship Gate)

A slice ships only if all answers are yes:
- Does this reduce coupling in the targeted seam
- Does this preserve revenue-critical flow behavior
- Does this reduce support burden or policy ambiguity
- Can this be rolled back quickly with low operational risk

Any no blocks merge.

## Success Metrics Per Cycle

Track per cycle and per lane:
- Hotspot file line-count reduction trend
- Number of extraction slices merged and verified
- Regression count in protected flows
- Mean time to isolate issues in touched seams
- Rollback count and rollback recovery time

Cycle target:
- Downward risk trend without regression spikes in protected flows

## Operating Cadence

Cadence for active cycle:
- Weekly lane planning check
- Per-slice verification before merge
- Post-deploy verification within same cycle window
- Weekly board and metrics audit update

Audit artifacts:
- docs/refactor/REFACTOR_BOARD.md
- docs/refactor/REFACTOR_METRICS_LOG.md
- docs/refactor/HOTSPOT_OWNERSHIP_MATRIX.md

## Enforcement

This protocol outranks ad hoc refactor decisions for the three locked lanes.

Any exception requires:
- Written rationale
- Owner and reviewer approval
- Explicit rollback plan
- Logged exception note in board and metrics artifacts
