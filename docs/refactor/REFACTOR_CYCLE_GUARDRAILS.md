# MealScout Refactor Cycle Guardrails (Q2 2026)

Status: Active freeze window for the current refactor cycle.

This document is the enforcement layer for the refactor sequence. If a change does not fit the allowed lane below, it waits until the cycle closes.

Refactor work also follows the QA + DRY release gate in
`docs/process/QA_DRY_RELEASE_GATE.md`. Do not start pure cleanup until current
behavior has QA evidence, Critical/High UX defects are handled, and the refactor
has behavior-parity evidence plus re-QA.

## Allowed During This Cycle

- Bug fixes
- Auth/payment/booking reliability work
- Mobile regressions
- Explicit refactor tasks mapped to phases in this cycle
- LISA contract extraction only

## Blocked During This Cycle

- New major features
- New monetization surfaces
- New intel-heavy workflows inside existing monolith files
- Schema redesigns unrelated to refactor

## Required PR Mapping

Each PR must declare one lane:

- `critical-bug-fix`
- `phase-1-runtime-composition`
- `phase-2-route-composition`
- `phase-3-storage-split`
- `phase-4-lisa-contract-boundary`
- `phase-5-oversized-route-splits`
- `phase-6-schema-modularization`
- `phase-7-slo-protection`
- `phase-8-repo-role-cleanup`

If a PR cannot map to one lane above, it is out of scope for this cycle.

## Mandatory Metrics Check

Before and after each merge, update:

- `docs/refactor/REFACTOR_METRICS_LOG.md`

Track:

- Auth success rate
- Booking completion rate
- Payment success rate
- Mobile route latency on core screens
- Ordering gate success/failure telemetry
- App boot success
- Error volume

## Mandatory Refactor Intake

Before opening a refactor PR, complete
`docs/process/DRY_REFACTOR_INTAKE_CHECKLIST.md`.

Before merging a pure refactor, attach:

- behavior-parity evidence
- relevant contracts/tests
- manual QA repeated after cleanup
- confirmation that no feature expansion is mixed into the refactor

## Sacred Flow Protection

These flows outrank refactor velocity:

- Auth/session
- Booking
- Payments/Stripe
- Ordering subscription gate
- Mobile responsiveness on primary pages

If one regresses, pause and stabilize before moving to the next phase.

## Canonical Sequence

1. Phase 0 freeze
2. Phase 1 runtime composition
3. Phase 2 route composition
4. Phase 3 storage split
5. Phase 4 LISA contract boundary
6. Phase 5 oversized route splits
7. Phase 6 schema modularization
8. Phase 7 SLO protection throughout
9. Phase 8 repo role cleanup in parallel with docs

## Refactor Cycle Done Definition

The cycle closes only when all are true:

- `server/routes.ts` is a composition root, not a feature slab
- `server/storage.ts` is a facade, not the domain universe
- `shared/schema.ts` is an export barrel, not the full schema body
- MealScout only hosts LISA contracts/adapters/views (not LISA core reasoning)
- Auth, booking, payments, and mobile core flows remain stable
- No major feature expansion was required to complete this cycle
