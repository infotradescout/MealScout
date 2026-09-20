# MealScout Parking Pass native migration and process proof

## Objective
Continue MealScout only. The owner waived the billing-blocked GitHub check. Proceed with actual release engineering, not another wait for that job; preserve all application and financial safeguards.

## Base branch/commit
Existing PR380 branch `codex/ui-ux-front-end-overhaul-20260915`, starting at `e7dc7b668e1ea2aa76341f428b3847e750f86856`. Source-bound security/map and Orders work remains intact.

## Current branch/commit
Verified source: `c5be87ae5f97b589583dd5cc960c2e0b830eeaf1`. Migration repair: `fa3dd17ab3822a63b9d7a670d52c64cc7f2af800`. The containing proof commit adds documentation only. Resolve its exact remote SHA before writing. Continue in the existing MealScout-map-security-20260919 worktree; no other worktree or shared dependency installation changed.

## Verified completed work
Recorded the owner's CI exception in `docs/qa/mealscout-ci-exception.md` and PR comment5746995133. Do not call the historical unexecuted job a pass or make it a wait gate again. Global GitHub protections and billing/access settings were not modified.
Native testing reproduced a migration defect: a same-named non-unique index was accepted, then the previous unique constraint was removed. Migration142 now validates the actual active unique index before removing the old guard. Mismatched keys, predicates, invalid readiness and non-unique definitions cannot count as replacement protection. The expected predicate is parsed by PostgreSQL using matching column types; no backend payment/status rule changed.

## Files changed
`migrations/142_parking_pass_active_booking_uniqueness.sql`; `scripts/qa/parking-native-process.mjs`; `scripts/qa/parking-native-worker.mjs`; CI exception, this handoff and `docs/qa/mealscout-parking-native-process-proof.json`. Client, server, shared schemas, package manifest/lockfile and preview executor are byte-unchanged from the base.

## Tests/evidence already run
Native PostgreSQL:25/25 cases, zero failures, including actual migration058/142 through the existing statement runner, interrupted installation, wrong-index rejection, rebooking with history preserved and duplicate active booking exclusion.
Sixteen concurrent insert attempts across separate OS processes produced exactly one active event/truck row. Twenty-four concurrent HTTP retries across processes produced exactly one recorded synthetic operation. Process restart, lost receipt write, expired reference, database outage and process death after an operation did not cause reexecution.
Concurrent expiry invoked the simulated provider cancellation once, preserved booking history and retained paid/processing/capturable/fresh-group holds. Death after provider cancellation rolled back the real SQL transaction; a later process safely recovered the cancelled intent without another cancellation.
Existing integration suites also pass:hold expiry40/40 and durability26/26. These older suites use PGlite; they are not conflated with native separate-process proof. Full UI/build gates were not rerun because no client/server/package code changed; prior source-specific receipts retain their original scope.

## Evidence locations
`docs/qa/mealscout-parking-native-process-proof.json` binds exact source hashes, all native cases, compatibility outcomes and cleanup. Raw artifacts are in `.qa-evidence/parking-native/`. Credentials in private-config files remain local and are excluded from the committed receipt.
The UTC-corrected baseline is19 passes/one real migration failure. Initial import/timezone fixtures and a pooled temporary-session cleanup assumption were corrected separately and their failed logs were retained, not relabeled as successful product tests.

## Changed but unverified work
No unverified change remains within this migration/guard/expiry slice. Full host-route capacity across different trucks, actual insurance decisions, external Stripe/webhook behavior, deployment migration replay and old-worker rollout remain unproved. This is not full Parking Pass or production acceptance.

## Tests/evidence invalidated by later changes
No migration code changed after the passing20-case repair. Five added definition/cleanup cases were validated in the final25-case run. The final fixture correction pins session-local temp-table checks to one explicit native client; it does not relax migration assertions.

## Known blockers/risks
The billing-blocked GitHub check is owner-waived for this continuation, not an unresolved decision or reason to stop. Other application/provider requirements are not waived. Native fixture proof omits unrelated foreign-key tables and actual booking handlers; do not call it full production capacity or migration-chain proof.

## External side effects and retry safety
Five owned native clusters were stopped and removed; a read-only supplement confirms all30 recorded worker/provider/database ports refuse connections. Original immediate observations are retained. No real account/booking/payment/refund, provider activation, production merge/deployment/migration, external message or billing/access change occurred. Only the MealScout task branch is a push target.

## Next exact action
Continue the full host booking route's native multi-process capacity and eligibility tests using actual handlers and disposable infrastructure. Then follow the existing controlled worker-drain/migration/provider rollout requirements. Apply the owner's single CI-job exception rather than reintroducing a billing wait or disabling unrelated safeguards.

## Actions that must NOT be repeated
Do not re-audit the project, redo completed UI/security/onboarding work, mutate other worktrees, replay a fixture against customer data, loosen financial controls or test assertions, treat simulated provider responses as real payments, or silently mark unexecuted CI as passing. Preserve the approved full MealScout scope.
