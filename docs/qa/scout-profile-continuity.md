# Scout / public-profile continuity acceptance

Date: 2026-09-17. Scope: PR #380, `codex/ui-ux-front-end-overhaul-20260915`.
Base: `28857357de34cebf0d4798c838d5883117dd9869`. Core continuation commit: `c6146b55`.
This is frontend acceptance, not production, native-auth, payment or map-provider acceptance.

## Implementation
`client/src/lib/scout-journey-state.ts` owns a versioned, validated, tab/account-scoped view snapshot with a 30-minute lifetime. Unresolved identity cannot read/write a guest snapshot. Expired, future-dated, malformed and wrong-account records do not restore. Denied storage does not break navigation.

Only search mode/query/filter, scene/craving, discovery radius, map center/zoom/expanded state/layers/selected marker identity, scroll position and a safe Scout return route are stored. No results, availability, booking/payment state, profile data or credentials are stored. OAuth codes/tokens/arbitrary redirect parameters are excluded from the return route; approved attribution/preview parameters survive.

The active `explore-preview-v2.tsx` owner restores through the existing search context and `useScoutJourneyPersistence`. The view remounts on account changes. Restored marker identity is resolved against current query data, not a serialized old entity. Scroll recovery is bounded and yields to user input. Current location/recenter and availability policies remain authoritative.

The existing profile header, unavailable-state and footer Scout links use the saved account-scoped route. The original visible Scout label and single-action-layer design remain; an unchanged shell contract caught an alternate label and the implementation was corrected rather than weakening that contract. Canonical/share URLs and profile economics are unchanged.

## Observed verification
- 41/41 Node cases: the previously unexecuted 19 profile-recovery cases plus 22 new Scout state cases; zero failures/skips.
- 13/13 affected existing regression checks covering profile shell/actions, quality signals, route resolution, map truth, claim prompts and affiliate/share protections.
- Full repository TypeScript check: explicit final exit 0.
- Actual Vite frontend build: exit 0 with an isolated environment and synthetic public test key. No backend/provider secrets supplied.
- 32/32 actual compiled-frontend browser scenarios: 16 each at 1440x900 and 390x844, installed Chrome, zero page exceptions.

Browser coverage includes guest Save/Recommend -> actual login UI -> exact original profile path/query/hash -> explicit action; no auto-mutation on login; acknowledged success, non-success and rapid duplicate clicks; quick-review modal close preserving recommendation; 503/malformed profile retry; 401/403/404/410; typed-slug resolver retry; account/expiry boundaries; seeded search/filter/scene/radius/layer/map-view restoration; reload/browser back; and an actual nonempty thin-market Scout View profile click and return to the attributed discovery route.

Save is measured at least 44x44px, Recommend at least 44px high; profile captures have no horizontal overflow. Both mobile/desktop profile screenshots were visually inspected.

## Durable gates
The existing preview executor retains all 20 stages and adds `scout-profile-state` and `public-profile-browser`. The new suites were successfully executed locally before adding them to the hosted gate. A future READY preview must not be described as a directly observed 22-stage summary unless that summary was read.

## Evidence and limits
Local evidence directory: `.qa-evidence/scout-continuity-20260917/`.
Receipts: `final-state-tests.log`, `profile-affected-contracts.log`, `final-typecheck.log`, `profile-browser-build.json`, `profile-browser-results.json`.
Captures: `profile-controls-390.png`, `profile-controls-1440.png`, `scout-roundtrip-390.png`, `scout-roundtrip-1440.png`.
Earlier failed browser receipts are preserved: modal assertions initially looked behind an open accessible dialog, generic fixture responses omitted discovery arrays, and a thin-market case initially assumed scene controls that that surface does not render. Corrected tests use the actual dialog/empty-data/thin-market behaviors; production authorization was not changed.

All browser APIs/auth responses and restaurant data are synthetic; external requests, service workers and WebSockets are blocked. The loopback server serves the real compiled frontend only. No real accounts, messages, charges, bookings, inventory or provider settings were changed. Live map-provider gestures/selection, native authentication, real Stripe, concurrent native booking capacity and the connected production-handler transaction chain remain unproved.

Next unproved UI acceptance: fuller-market map/result selection and menu/order/book/share continuation, followed by the existing onboarding/claim work. Do not restart completed recovery tests, Parking Pass polish or GitHub Actions startup investigation.
PR #381 remains separate. No merge or production migration. Retain migration 142 rollout order, drain legacy destructive expiry workers before new-worker activation, retain terminal booking history and earlier request tombstones.

## September 17 continuation: persistence timing under active renders

Base: `7fbd35bc3b4a485093acde86b58824d6e985bd50`.
The actual hook's reset-on-every-render debounce can indefinitely postpone a checkpoint while Scout keeps rendering. Two new actual React/browser cases reproduce this on the base: both fail to save the entered search within 1.5 seconds while rendering every 20ms (one with stationary view values, one with changing map coordinates).

The repair retains the first 250ms save deadline and writes the latest view. Repeated renders do not reset a pending timer. Account/unmount cleanup cancels the pending callback and retains the existing final flush. This changes no state schema, lifetime, account-key policy, route, API or provider integration.

Observed verification:
- Baseline timing suite: 0/2 passed. Corrected suite: 2/2 passed in installed Windows Chrome and 2/2 with pinned Linux serverless Chromium 143.
- The tests also require bounded writes, the final unmount flush, and no timer writes after unmount.
- Existing recovery/state suites: 41/41 passed; full TypeScript check exited 0.
- Rebuilt actual frontend successfully; all 32 existing profile/Scout desktop/mobile browser scenarios passed after the hook repair.
- The preview executor retains its previous 22 stages and adds `scout-persistence-timing`. Configured stage count is not hosted acceptance.

Evidence: `.qa-evidence/scout-persistence-timing/` (baseline, candidate, regression and typecheck); Linux evidence at `/home/flavorgood/.local/share/si-verification/mealscout-hosted-7fbd35bc/evidence/`.

The original failed hosted build log remains unavailable: the Vercel log action is missing, local CLI requires a new Vercel login, and the authorized preview-share log link still reaches Vercel login. This timing defect was independently reproduced; it is NOT established as the original hosted failure's root cause. The original 41 state and 32 browser cases also passed a clean Linux reproduction with the hosted default temp/font configuration. An initial custom-temp reproduction had missing fonts because the browser's fontconfig references `/tmp/fonts`; its failed receipts were retained and are not application-defect evidence.

The requests to execute the native full release gate and to write a full-preview Linux reproduction wrapper were blocked before execution/write. Neither blocked operation was rerouted. No production change or full native release pass is claimed.

## Recovered hosted failure and featured-menu cancellation

The log-access limitation above is resolved. Authorized `vercel login` completed, and the authenticated CLI retrieved the actual original `7fbd35bc` deployment log. It showed 21/22 stages passed. All 32 individual profile scenarios passed, but the final **Every API request must be intercepted** guard correctly failed because a featured-item request reached the loopback fixture server. This was not a Vite compile failure or evidence of a production request. Do not confuse individual scenario passes with full-suite acceptance.

The separate persistence-timing head `1651d7d7bc26b4ded076527c6b747674b37d17e8` subsequently completed hosted verification: `dpl_BRrn7DpjvAtY7jMfSwBnKj9Awmbo`, 23/23 actual QA stages passed in its retrieved execution summary. GitHub independently reported successful deployment. That success alone does not eliminate the original teardown race.

This continuation addresses both lifecycle owners:
- The active Scout featured-menu fetch consumes its existing TanStack Query AbortSignal, so leaving Scout cancels the obsolete read rather than letting it continue after navigation. Endpoint, credentials and response interpretation remain unchanged.
- The browser fixture explicitly handles featured items, stops its document while routing is still active, then closes pages/context. Pending held fixtures are released for abort, not forwarded. The fixture server still rejects every escaped API request, and its empty-leak assertion remains unchanged. Leaks now carry a synthetic scenario identifier for diagnosis.
- Quick-review scenarios dismiss with the actual Done control and verify the dialog is gone before checking its background action; no mutation-count assertion was removed. A final suite receipt separately records scenario outcomes and isolation-guard acceptance.

Two new actual compiled-UI cases (desktop/mobile) hold a featured read, use client-side View profile navigation, prove it is the same browser document and require the request's AbortSignal to fire. Both failed on the prior application and passed after signal wiring.

Observed local acceptance of the functional repair:
- New cancellation baseline: 32 existing scenarios passed, two cancellation cases failed.
- Initial cancellation candidate: all 34 scenarios passed but the global isolation guard still failed; retained as failure evidence.
- Final document-drain lifecycle: two consecutive Windows runs passed all 34 and the isolation guard. The rebuilt Linux app with pinned Chromium 143 also passed all 34 and the guard.
- Full TypeScript check exited 0; 13 affected existing contracts passed. Frontend builds passed on Windows and Linux. Existing 48 frontend journeys passed at the immediately preceding timing head; exact latest hosted regression must be observed before claiming the new candidate's release status.

Evidence: `.qa-evidence/scout-featured-cancellation/` (baseline, candidate, drain, final-1, final-2, contracts/typecheck); Linux `evidence/featured-cancellation/`. Recovered original log and the actual 23-stage predecessor summary are under `.qa-evidence/scout-persistence-timing/` as `original-hosted-build-7fbd35bc.log` and `hosted-1651d7d7.json/log`.

No release stage, authorization rule, fee, booking policy or provider requirement was removed. PR381/native full release remains separate and unpassed; no production migration or customer transaction occurred.
