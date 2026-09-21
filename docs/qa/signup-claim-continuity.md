# Authenticated signup claim continuity

Continuation of PR #380 from `5c5bce54639a456db22591174b5597df56c94b92`.

An authenticated owner's exact-listing handoff could finish after they edited the search, restoring the old listing and overwriting the business fields. A delayed manual search could also restore selectable results after the query was cleared. The signup view now invalidates obsolete reads when the query, selection, account, business type, or mounted view changes. Each request applies success, error, and loading state only while it belongs to the current search context. The existing exact listing ID handoff and server claim authority are unchanged.

The new compiled-browser cases run at 1440px and 390px. They exercise a late successful exact-ID response after an edit, a late manual response after clearing the query, and a late failed search after a newer successful selection. Successful selection directly checks the listing query, business name, and address. Manual recovery must drop the previous exact listing ID.

## Evidence before integration

- Baseline compiled from unchanged `5c5bce54`: 108 scenarios, 104 passed and 4 failed, zero unintercepted API requests. Both new stale-success cases failed at both viewports. The delayed-error case was added afterward and is not part of that baseline count.
- TypeScript and `npm run build:client` passed after the production fix. Existing chunk-size warnings remain.
- First candidate full browser run: 108 scenarios, 104 passed and 4 failed. The stale-response behavior passed, but an overly broad new assertion counted the signup page's intercepted `/api/telemetry/track` POST as a business write. That assertion now permits only the exact existing telemetry POST paths; the runner's global API isolation check and write rejection remain unchanged.
- Final focused browser run: 6/6 cases passed, zero unintercepted API requests. Desktop/mobile captures were inspected. The external subset wrapper selects only these cases without changing the repository's full runner.

Evidence is retained separately in the receiving task's `outputs/meal-onboarding/baseline/`, `candidate/`, and `targeted/`; command logs are `work/meal-onboarding-*.log`. The browser harness serves `client/dist` from `npm run build:client`. The unchanged full integration gate must run on the final committed source; its subsequent receipt belongs in `outputs/parallel/commerce-next.md`.

All identities and responses are synthetic. The new journeys never submit a claim, create an account or business, send a message, publish a menu, change payment/provider settings, or enable ordering. This proves search-to-selection continuity inside authenticated signup, not real ownership or end-to-end publication. PR #381, unrelated `.qa-evidence/`, the GitHub account billing lock, and production release boundaries remain separate.
