# Claim search continuity

Objective: continue business onboarding from the customer-menu checkpoint at `ff8e8e0b054612e425ce88d2636fd36e2e7281ad` on draft PR #380.

The claim page previously retained the earlier truck's claim action after a newer search failed. Invalid JSON and invalid response collections appeared as valid empty searches. A slow earlier response could replace newer results, and editing or clearing the query left old results actionable.

The page now clears results on a new search or query edit, accepts only the current request's response, invalidates pending responses on account identity change/unmount, and validates the fields used by claim result cards. Failed or malformed reads display the existing retryable unavailable message; a valid empty list retains the distinct no-match message. A delayed setup response cannot refresh an obsolete query or replace the current query's error state. These changes do not alter claim authority, authentication, reminder delivery, rate limits, merchant ordering readiness or server endpoints.

## Executed proof

- Unchanged compiled baseline: 82 scenarios, 70 passed and 12 failed. The failures covered six claim-search cases on both 1440px desktop and 390px mobile; the existing 68 cases and valid-empty checks passed.
- Final candidate: all 86 scenarios passed, zero unintercepted API requests. Includes four additional delayed setup success/failure cases across both screen sizes. The preceding candidate had 82/82. Actual compiled UI with synthetic APIs/auth only; no production or provider writes. The existing runner's global isolation assertion remains mandatory.
- TypeScript and browser-specific client build exited 0. The preceding candidate also passed the platform client/server build; the final revision's full platform build is delegated to its unchanged hosted gate. Existing build warnings remain.
- Desktop/mobile claim screenshots were inspected; only the latest search result remained visible after the earlier response completed.

Commands: `npm run check`; `npm run build`; `npm run build:client`; `node scripts/qa/public-profile-browser.cjs` with `QA_EVIDENCE_DIR` pointing to a fresh receipt directory.

The platform build writes `dist/public`; the browser runner serves `client/dist`, produced by `build:client`. An intermediate candidate attempt served the stale baseline output and is excluded from candidate proof. Its failure record is retained.

Evidence is preserved in the receiving task at `C:/Users/flavo/Documents/Codex/2026-09-17/you/outputs/meal-claim/`: `baseline`, `candidate` (stale output), `accepted` (82 cases), and `final` (86 cases). Logs are in that task's `work/meal-claim/`. Current source identity is recorded in the receiving task's final checkpoint. An attempted protected-preview public-search GET returned a redirect body, not a JSON result, and does not establish real-data claim-search acceptance.

## Next transition and boundaries

Preserve PR #381 separately. Obtain hosted acceptance for the exact new PR #380 revision, then continue the selected listing through owner onboarding and published-menu/ordering-readiness states with synthetic accounts. Local UI proof does not certify real ownership claims, email delivery, payments, provider release or production deployment. Do not activate ordering merely because a sampled business currently has it unavailable. Do not repeat the five-day audit, resolved menu work or provider setup.
