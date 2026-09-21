> Latest continuation: `MEALSCOUT_PARKING_NATIVE_HANDOFF.md`. The owner waived the billing-blocked GitHub check in `docs/qa/mealscout-ci-exception.md`; the historical billing-wait requirement below is superseded for this PR continuation.

# MealScout security and map recovery — September 19, 2026

## Objective
Continue MealScout only from the saved PR #380 candidate. Remove the reported dependency advisories, preserve both existing Scout maps, and prove map recovery without losing actionable place pins. Existing product features, design, fees, financial rules and owner permissions remain unchanged.

## Base branch/commit
`codex/ui-ux-front-end-overhaul-20260915`, existing draft PR #380, starting at `a434dc54b80c3e6c6a88985a52acb53a9b607181`. The older Orders/native checkpoint remains historical evidence, not the resume point for this continuation.

## Current branch/commit
Verified application candidate: `d41be907efde457a3b98bec354c3e0f8ef606761`. The commit containing this handoff adds evidence only. Resolve the current remote task head before the next write; do not reset other worktrees. Continue in the `MealScout-map-security-20260919` worktree, which has its own dependency installation, not the older shared node_modules junction.

## Verified completed work
MapLibre GL moved from 5.24.0 to exact 6.10.0. Both existing map components now share the namespace-import runtime and a Vite-bundled `?worker&url` worker. No separate map implementation, hosted worker dependency or CSP relaxation was added.
Compatible, non-forced lockfile security updates address the remaining parser/build dependencies. The candidate's installed npm audit reports zero critical, high, moderate, low or informational findings. That is not a claim about production/main or proof that the whole application is free of defects.
New browser checks uncovered a real retry defect: after tile denial, the map canvas returned but place pins did not. Both marker effects now resynchronize when the map is replaced. Mouse clicks and keyboard selection are verified after recovery. Devices without WebGL or without WebGL2 retain the honest approximate-pin fallback.

## Files changed
`package.json`, `package-lock.json`, `client/src/lib/maplibre-runtime.ts`, the two existing `client/src/components/maps/themed-scout-map*.tsx` components, `scripts/qa/carto-map-browser.cjs`, and `scripts/qa/maplibre-security.browser.cjs`; this handoff and its machine-readable receipt. The existing preview gate and deadlines are unchanged.

## Tests/evidence already run
The vulnerable 5.24.0 library produced four failing sanitizer checks and four passing control/worker checks. The patched library passes all eight checks, including consecutive unsafe attributes, legitimate attribution links and real clustered-GeoJSON worker messages.
Both map components pass 20 browser cases across mobile/desktop, including missing configuration, configured maps, denied-tile retry, no WebGL and no WebGL2. The four missing-pin baseline failures are preserved separately. Current-source compiled-frontend regression passes 88/88; order reader 40/40; existing owner state 31/31; Orders workspace contract passes. Full TypeScript, client build and server build pass.
The patched backend/dependency state at `f120a17363120f65108611e3ae4dbfbffb5200b1` passed 46 native PostgreSQL/backend/browser checks. The subsequent map-only repair leaves server, shared schemas, package manifest, lockfile and native harness byte-unchanged. The receipt preserves that source boundary rather than claiming the native run executed at a different SHA.
The source-bound hosted result, deployment identity, exact stage outcomes and log hash are recorded in `docs/qa/mealscout-map-security-2026-09-19.json`. Hosted synthetic-browser acceptance and native PostgreSQL acceptance remain distinct. The long hosted frontend summary can be truncated by log transport; use the complete local receipt for its exact 88-case count.


Hosted preview `dpl_A1z4fioTwQvDFuoED6D2Avdp6XEF` is READY at application source `d41be907efde457a3b98bec354c3e0f8ef606761`. All 24 required stages passed; the hosted profile suite passed 118/118 in 145921 ms within its unchanged 180000 ms deadline. Hosted map checks passed 20/20 plus 8/8 security checks. Log SHA-256: `8ef032b39890123e371167f7a42bb08b7b85476a826477c48469e929d1000341`.
Six dependency-level HTTP checks using the actual menu upload configuration also passed, including allowed uploads, unchanged ten-MB limit, unsupported/duplicate/malformed rejection and subsequent recovery. These are not full authenticated upload-route/provider acceptance.

## Evidence locations
`docs/qa/mealscout-map-security-2026-09-19.json` binds source files, dependency deltas, audit output, before/after browser cases, native source/cleanup, hosted stages and raw-artifact hashes. Raw local evidence is retained under `.qa-evidence/map-security/` and `.qa-evidence/native-orders/`. Earlier worktrees, manifests, lockfiles and shared installed dependencies were verified unchanged.

## Changed but unverified work
No unverified application edits remain within this security/map continuation. The later evidence-only commit has not itself received a separately observed hosted result; do not relabel the application-source preview. Live payment/email/CARTO authorization, production deployment and the remaining broader release requirements are not established by these checks.

## Tests/evidence invalidated by later changes
The strengthened pin assertions first produced four genuine denied-tile recovery failures. Those results were not overwritten or weakened. After repairing the lifecycle dependency, the expanded 20-case map suite passed. The final dependency set and unchanged backend are verified by the native source recorded above, not by an older dependency environment.
One fresh native runtime did not become healthy within the original startup deadline; its logs and cleanup are preserved. A fresh retry with the same code and unchanged startup bounds passed both viewports. The cause of the initial startup failure was not established.

## Known blockers/risks
The current GitHub Actions check still executes zero steps because of the explicitly reported account billing lock. No required-check, billing or access changes were made. The candidate npm audit is zero; main/default-branch alerts remain a separate observation until integration.
Existing migration 142 and worker compatibility, request/terminal-history tombstones, native multi-process capacity, and connected-provider acceptance remain release requirements. Historical audits do not supersede the current verified source or the approved product scope.

## External side effects and retry safety
Only the existing MealScout task branch was updated; its existing integration automatically built previews. No production/main merge, customer record, real payment/refund, external message, provider activation or billing/access change occurred. The three native runtime attempts in this worktree were stopped, their owned PostgreSQL clusters removed, and all six exact application/database ports observed ECONNREFUSED. Browser fixture servers were closed by their test cleanup.

## Next exact action
Resume at the current remote task head and this security handoff, not the stale generic tracked claim checkpoint. Continue the existing migration-142/worker-compatibility and native multi-process Parking Pass release proof using disposable infrastructure and the preserved helpers. Keep the required GitHub billing failure visible until resolved; production/provider acceptance is still required before release.

## Actions that must NOT be repeated
Do not restart a repository audit, redo completed onboarding/menu work, loosen tests or rate limits, overwrite failed evidence, replay tests against a used/customer database, modify another worktree's shared dependencies, work on other projects or treat preview acceptance as production release. Preserve the approved full MealScout product scope.
