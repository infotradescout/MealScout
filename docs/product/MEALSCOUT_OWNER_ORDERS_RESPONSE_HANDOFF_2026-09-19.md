# MealScout Orders/Kitchen native recovery - September 19

## Objective
Continue MealScout only. Prove Orders/Kitchen read recovery against actual backend/native PostgreSQL and repair contextual session-expiry recovery without changing transaction authority.

## Base branch/commit
Existing draft PR380 branch: codex/ui-ux-front-end-overhaul-20260915, starting at 7cb37c68409f6558dfd4c572adf1a96c99d34d81.

## Current branch/commit
Application implementation: 9f9b64970785364728d4f887afee2645986a6174. The commit containing this handoff adds the final native harness and proof only; resolve its remote head before resuming. Application files did not change after build/native/hosted acceptance. Native harness Git blob c111646b004462d46ab5f7cac4e96e0646e270ea; SHA-256 f388959d50fa71cad8434a0475a3e8c707aaaaec8814ece2bb8baa09de4413ef.

## Verified completed work
Orders/Kitchen401 now shows Sign in again, preserves the exact view/business and forces fresh auth state. Real password login returns to the original orders.403 remains distinct. Nine read/financial/mutation/action declarations are unchanged from base; no server, permission, price, refund or settlement edit.

## Files changed
client/src/components/owner-orders-workspace.tsx; scripts/qa/owner-orders-recovery-journeys.cjs; scripts/qa/owner-orders-native-browser.cjs; this handoff; docs/qa/mealscout-native-orders-2026-09-19.json.

## Tests/evidence already run
Native PostgreSQL/backend/browser:46/46,23 per fresh runtime at1440x900 and390x844, zero failures/page errors.32 are browser stages;14 are repeated setup/API/database/access/integrity stages. Actual registration, local verification, claims, password sessions and order-read handlers;55 explicitly seeded order snapshots per runtime. Final expiry tests expire the exact session row in native PostgreSQL. Actual SQL outages, pagination50+5, six-status kitchen projection, malformed/wrong-business reads, delayed retry, true emptiness and reauthentication recover without order writes. Final order/item row hashes unchanged.
Current-code synthetic frontend:88/88. Response reader40/40, existing owner state31/31, workspace contract PASS, full TypeScript/client/server builds exit0.
Exact application preview dpl_GEnEDGtHqBxmpXJDutfbdtAPhVKY is READY:24/24 unique required stages code0; public-profile browser118/118 in155658ms under the unchanged180000ms limit. Execution summary binds 9f9b64970785364728d4f887afee2645986a6174. Complete log SHA-256 cf833e48dcbde110d18a64144423dcfe94ce8bd5e0d91d23324b9eccd920b53c. Hosted frontend count is truncated in transport; exact88 comes from the separate full local receipt, not an inferred hosted count.
Reviewed native mobile expired/recovered Kitchen screenshots. Traces and earlier failing attempts remain separately retained. Initial35-pass/4-fail baseline proved the missing sign-in action. A later combined-viewport run hit the real429 limit; final runs use fresh per-viewport fixtures, with rate limits unchanged.

## Evidence locations
Source/harness hashes, all native cases, hosted stages, check failure, dependency audit and raw artifact hashes: docs/qa/mealscout-native-orders-2026-09-19.json. Raw evidence and reused native-helper manifest: .qa-evidence/native-orders/ in the preserved MealScout-orders-qa-20260919 worktree. Earlier .qa-evidence/orders-recovery/ remains untouched. Private runtime configurations/mailboxes/trace contents stay local.

## Changed but unverified work
No unverified application edits remain in this bounded slice. This containing test/evidence commit has no separately observed hosted preview yet; earlier preview is explicitly application-source evidence, not a claim that a different SHA ran. Whole-product/provider/payment/migration/production acceptance remains open.

## Tests/evidence invalidated by later changes
No later application changes. Final test harness uses fresh per-viewport runtime and actual persisted session expiry, without weakening test assertions or real rate limits. Prior incomplete captures/fixture errors/429 attempts remain failures, not relabeled acceptance.

## Known blockers/risks
GitHub Actions job105976717275 executed zero steps and explicitly says the account is locked due to a billing issue. No billing/access/required-check bypass occurred.
Candidate package-lock audit:1critical,4high,4moderate,1low. MapLibre GL5.24.0 is flagged by GHSA-jrc7-96c5-q579, patched upstream beginning6.4.1. Upgrade and reachability assessment remain unperformed; do not equate this candidate audit to the default-branch warning count.
Existing migration142/worker compatibility, multi-process capacity, terminal-history/request tombstones and connected-provider rollout still need their recorded release proof. Schema push is not migration replay.

## External side effects and retry safety
All six owned local runtimes stopped, all six PostgreSQL clusters removed and all12 exact app/database ports observed ECONNREFUSED. Actual order fields unchanged. No customer records, real payments/refunds, external messages, provider activation, production merge/deployment, other-project or original-helper changes. Only the existing task branch is a remote write target; its Git integration automatically creates previews.

## Next exact action
Resume at the current remote task head and inspect its automatic preview. Then remediate the candidate MapLibre advisory using isolated dependencies and the existing map/type/build/browser gates. Preserve the blocked required GitHub check until the billing lock is resolved. Follow the existing142/worker/provider release plan rather than declaring the platform ready from UI tests alone.

## Actions that must NOT be repeated
No new repository audit, redoing saved onboarding/menu flows, replay against a used/customer database, disabling limits, altering gate deadlines, overwriting failed evidence, mutating the shared node_modules junction target, switching other worktrees, other-project work, or premature production release.
