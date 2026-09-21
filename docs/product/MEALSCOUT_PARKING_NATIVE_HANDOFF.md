# MealScout Parking Pass — verified candidate and controlled rollout

## Scope and authority
MealScout only, PR380, branch `codex/ui-ux-front-end-overhaul-20260915`. Preserve `docs/product/MEALSCOUT_END_TO_END_FLOW_UX_MATRIX.md` and all existing feature/UI work. The billing-blocked GitHub check is owner-waived: never make it a waiting gate or label it passed. Desktop Commander is not a dependency. Reuse the existing executor; do not create another proof service.

## Latest exact executed source
**`215b6868bab791017fdbf8682e681c82a9d045e3`**, tree **`667b3256d9470fa437404035e4cd47f22da4c8f8`**.
Final execution: existing Render service `srv-dao026n40ujc73ddeua0`, deploy `dep-daom0p2jnfac73eq93ug`, September21 `16:51:14.594Z` through `16:52:44.135Z`.
**Candidate result PASS:20/20 registered host-route cases;11/11 native legacy-guard scenarios;11/11 release stages.** Full tracked source manifest is unchanged before/after:2793 files, SHA256 `82e1b494be3f45fc630a253f767bc5f18e8f6928b86f1a3c66be1a909c533aa5`.
Receipt: `docs/qa/mealscout-parking-integrated-release-proof-2026-09-21.json`.
Raw receipt SHA256: `4d2601d5e801bf89182749a740cf89eb8884bdb31269e59e2e7435075e8317a2`.
The commit containing this receipt/handoff is documentation only. Resolve its remote head before writing; do not call that later SHA the executed source.

## Application defect fixed and proved
The provider-create error catch previously cancelled holds and returned202. The actual route baseline reproduced all six new failures: a provider accepting a create then returning an error/disconnecting freed capacity, allowed a competing truck, and destroyed the recoverable checkpoint. A paid callback arriving before the error was overwritten as cancelled/payment_pending.
Repair `e86fcbd7fcdbb3473fd4e8e4159dfdcdaf36f433` changes only that catch: leave all booking/payment state intact, return503 `booking_request_unresolved` with the existing requestId, and retain the transactionally persisted checkpoint for evidence-only same-reference reconciliation. The route repair is unchanged in the final candidate.
Native20-case proof includes capacity1 under16 competing trucks, capacity3 under12 trucks, five eligibility denials, permission-revoked replay, retry/restart/process-death safety, cancelled/paid history, full-second-date rollback, returned503/disconnected responses, empty/unavailable search, pre-create failure, all multi-day holds retained, and paid-state preservation. Each accepted-error recovery keeps exactly one provider operation and does not call create again.

## Full-schema migration defect fixed and proved
After all canonical SQL ran, rebooking still failed because actual migration016 creates unnamed `UNIQUE(event_id,truck_id)`, materialized by PostgreSQL as `event_bookings_event_id_truck_id_key`. Earlier142 removed only `uq_bookings_event_truck`.
Final source215b6868 retains the existing strict active-index verification and then validates/removes both known all-history guard forms, including a standalone named index. Wrong definitions, wrong target table and bad active replacement indexes fail closed. No booking data is deleted; unknown dependencies are not cascaded away.
The new native regression executes actual016 and the retained previous142 bytes, positively reproduces PostgreSQL23505 on `event_bookings_event_id_truck_id_key`, then proves repair/rebooking/history preservation. Eleven guard scenarios pass, including wrong keys/predicates/nonunique replacements, both legacy names, wrong-table collisions and pre-existing active duplicates.
The real `runDeployMigrations.ts` executes all148 canonical files (124 bootstrap +24 release), with278 foreign-key constraints. Complete bootstrap/ledger counts are checked. Cancelled and pending bookings coexist, another active duplicate is rejected, and a second full runner invocation preserves both booking snapshots and the exact migration ledgers.
Only Neon-to-native PostgreSQL connection transport is adapted in this rehearsal; SQL and migration-runner logic are not replaced. The requiredpg_trgm extension was built once inside the existing owned PostgreSQL cache; no system packages or new hosted service were added.

## Integrated release checks completed
Final candidate passes all existing affected checks: TypeScript, expiry/durability/reconciliation integration, client request policy, webhook-safety scripts, deployment-migration contract, frozen-cleanup safety, acquisition routing and production build, plus the native migration stage.
The native20-case suite was preserved byte-for-byte as `scripts/qa/parking-host-route-core.mjs`; the existing hosted entry point is now a wrapper that records route and release scopes separately. Supporting modules: `parking-host-release-checks.mjs`, `parking-host-native-tooling.mjs`, `parking-migration-legacy-guards.mjs` and the exact retained old142 SQL fixture.
Source e101-to-c107 acquisition routing is preserved using exact main blobs in a two-parent integration commit807e3f6. No map/UI/Orders/onboarding feature was dropped. Earlier broad UI/browser receipts retain their original sources; they were not relabeled as executions of this candidate. The old25-case native migration receipt also retains its old142 source; it is not a claim of a fresh25-case execution after this repair.

## Retained failed evidence
- `docs/qa/mealscout-host-route-native-baseline.json`: original paid-hold failure.
- `docs/qa/mealscout-provider-response-native-proof-2026-09-21.json`: sourcef0c93060 had14pass/6fail; e86 repair had20pass, unchanged assertions.
- `docs/qa/mealscout-integrated-release-baseline-2026-09-21.json`: source807e3f6 passed route/type/build/affected tests but disposable PostgreSQL lackedpg_trgm.
- `docs/qa/mealscout-full-schema-history-baseline-2026-09-21.json`: sourcef0ff21af ran148 SQL files but the historical unique constraint blocked rebooking. The final native regression establishes the precise PostgreSQL cause.

## What remains — actual rollout, not another unchanged candidate test loop
Production remains at **`c10700e38d158f9b7378925a7cf3951b20fae9e1`**, Render service `srv-d5escdh5pdvs73foo41g`, deploy `dep-daojucgjo6nc73afbang` (read-only reconfirmed in this turn). PR380 is not merged and candidate215b6868 is not serving customers.
Next dependency is the existing controlled rollout: verify production schema/backup and migration ledger, drain all legacy booking/cleanup writers, apply the final142 migration with those workers stopped, execute the authorized connected-provider/webhook acceptance, then cut over and verify exact source and production health. Follow `docs/qa/parking-hold-expiry-and-schedule.md`; do not quietly substitute normal overlapping deployment for the required drain.
The current legacy source unconditionally registers its scheduler and includes pending-hold deletion. No supported drain/suspend action is exposed by the discovered Render connector; none was executed. No authorized real Stripe transaction/webhook path was established in this turn. Do not invent an old-source environment switch, infer provider acceptance from the loopback fixture, crash production via environment tricks, or merge just to trigger a deployment before these dependencies are satisfied.
The billing check is not among the remaining dependencies. Do not retest unchanged20/native/type/build gates merely because this documentation commit changes HEAD. Exact application/migration hashes and the complete source manifest already bind the passing candidate.

## Evidence boundaries and side effects
Session authentication and manageParkingPass storage/grants are database-backed fixtures. Provider transport is loopback; the paid-callback race uses synthetic SQL rather than the live webhook handler. Route tests use model-derived relevant tables; the separate migration rehearsal uses the full real schema/FKs. These distinct scopes must remain explicit.
Only the existing MealScout task branch and isolated Render executor were changed. The executor now has `MEALSCOUT_HOST_ROUTE_RELEASE_CHECKS=1`; existing canonicalnpmci remains. Owned native clusters were stopped and removed. The final migration cluster port45327 explicitly refused connections after cleanup; no separate final route-port probe was performed.
No customer accounts/bookings, production database, live payments/refunds, external messages, other projects, billing/access settings or the owner's computer were changed. Raw fixture logs/results remain under `.qa-evidence/host-route-native` during the hosted build, and source-bound normalized receipts are committed above.
