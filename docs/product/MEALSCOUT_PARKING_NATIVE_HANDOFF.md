# MealScout Parking Pass native route and controlled rollout handoff

## Objective and scope
Continue MealScout only on PR380, branch `codex/ui-ux-front-end-overhaul-20260915`. The owner waived the billing-blocked GitHub check; it is not a waiting gate and was not relabeled as a pass. Do not use Desktop Commander as a dependency. Preserve the complete product scope in `docs/product/MEALSCOUT_END_TO_END_FLOW_UX_MATRIX.md` and newer unrelated MealScout work.

## Latest actual source and action
Actual host-route implementation and test source verified: `603ff6a28478b9fafc1a0998f139eeac295082e3`, tree `5de0ebca0240fc0a95bdc2134c7816ecc36f1d32`.
The normalized passing receipt was committed in `eb205c4480e42c0af3e13992eb3b5e1baff218c1`. This handoff update is documentation only; resolve the current branch head before a write. Do not describe a later documentation SHA as the executed application SHA.

Reused the existing Render service `srv-dao026n40ujc73ddeua0` (`mealscout-host-route-native-proof`). Executed deploy `dep-daokvmbm8hqs73f3rdeg`. The actual run began `2026-09-21T15:40:50.570Z` and finished `2026-09-21T15:40:55.674Z`. Read all case results and the complete receipt from the Render build logs; a deployment marked live is not itself test success. Public receipt retrieval was unavailable to the reviewing web tool, so no claim of that retrieval is made.

## Newly verified work
**14/14 actual host-route native cases passed, zero failed, final source clean.** Four independent OS workers registered and executed `POST /api/parking-pass/:passId/book` against disposable native PostgreSQL16.14.

- Sixteen distinct trucks contending for one spot produced one active booking and one synthetic provider operation.
- Twelve trucks contending for three spots produced exactly three active bookings and three operations.
- Concurrent same-reference retries plus worker restart retained one booking/operation.
- Unverified email, unverified insurance, expired insurance, non-truck profiles and missing manageParkingPass grants produced no holds or provider operations.
- Revoking authority blocked a cached response from another process.
- A cancelled row survived rebooking unchanged, and an old paid pending hold survived another-date booking unchanged.
- A full second date rolled back the entire new multi-day hold group without a provider operation.
- Killing a worker after the provider operation recovered through another process without another create call.

The registered handler, eligibility policy, capacity SQL, durable middleware, recovery and migrations058/142 are actual application source. Session authentication, database-backed authorization/storage reads and provider transport are explicit fixtures. Tables are model-derived relevant tables, not a complete production schema/foreign-key/migration-chain proof. This is not live Stripe/webhook or production acceptance.

## Receipt and retained failures
`docs/qa/mealscout-host-route-native-proof-2026-09-21.json` contains exact source/tree, worker identities, case evidence, relevant file SHA256 values, execution identity, scope and cleanup.
`docs/qa/mealscout-host-route-native-baseline.json` remains unchanged: source `1e6e94c3` had13 passes and a genuine paid-hold preservation failure, plus a non-clean artifact boundary. The new run passes that assertion and ends source-clean; do not erase or relabel the baseline failure.

Prior proof remains at its original source:25 native migration/guard/expiry cases,40 PGlite expiry cases and26 durability cases, documented in `docs/qa/mealscout-parking-native-process-proof.json`. Earlier UI, map/security, onboarding and Orders receipts retain their original scope and source. Do not replay unchanged broad gates merely because this handoff changed.

## Current production and next dependency
A read-only Render deployment lookup observed production service `srv-d5escdh5pdvs73foo41g` serving commit `c10700e38d158f9b7378925a7cf3951b20fae9e1` from deploy `dep-daojucgjo6nc73afbang`, not the verified PR380 candidate. The newer main changes relative to the previously recorded base `e101c911` affect only `vercel.json` and `scripts/acquisition-edge-routing.contract.test.mjs`; preserve them when integrating the eventual release. No production merge, rollout, worker drain or migration was performed in this continuation.

Follow `docs/qa/parking-hold-expiry-and-schedule.md`: legacy workers must be drained before migration142 and candidate deployment. The legacy scheduler contains unconditional pending-hold deletion; changing a provider key or relying on normal overlapping deployment is not a verified drain. Do not invent an environment toggle that the old source does not implement. The discovered Render connector exposes deployment and environment operations but no service-suspension/drain action; provider/drain access was not changed.

Before connected-provider acceptance, cover one distinct unresolved failure branch: `hostRoutes.ts` still marks inserted holds cancelled/payment_pending when PaymentIntent creation throws. An accepted provider operation followed by a returned error/lost response must be tested explicitly for capacity retention and safe reconciliation. The passing process-kill test does not execute that catch branch and cannot be claimed as its proof. This is source-review risk, not a newly executed failing assertion.

Next work is that returned-error/provider acceptance and controlled migration/cutover, including exact integrated candidate identity and affected type/build/regression verification. Existing native runner remains reusable; do not create another proof service or reopen the waived billing check.

## Side effects and cleanup
Reused one existing isolated Render executor and added documentation to the existing MealScout PR branch. PostgreSQL was stopped and its owned temporary directory removed according to the passing receipt. Workers/provider were closed by the test harness; no additional port-closure probe was performed in this run. No customer accounts/bookings, production data, live payments/refunds, external messages, billing/access settings, other projects or the owner's computer were changed.
