# MealScout owner orders response recovery — 2026-09-19

## Objective
Continue MealScout only, from the saved UI/UX implementation. Prevent an unreadable, malformed, or wrong-business owner order response from looking like an empty kitchen or a verified zero count. Keep the existing retry path and all financial authority unchanged.

## Base branch/commit
`codex/ui-ux-front-end-overhaul-20260915` at `6f3a84d1f4bbcd87f37abeb969eb22643de09466` (draft PR #380). Base tree: `562a3f8970f7d6064ff0a23d5d15bd5f10474a52`.

## Current branch/commit
Same branch; the commit containing this handoff is the continuation candidate. Resolve its exact SHA from the branch before resuming. Source identity is additionally bound to the file hashes below, not to a chat claim or an older preview.

## Verified completed work
Both owner history and kitchen reads use the checked response reader with the selected business ID. Invalid envelopes, invalid rows, duplicate identities, other-business data, and invalid pagination throw an actionable read error instead of silently dropping data. Valid records, financial fields, item notes, and delivery fields are preserved. HTTP 401/403 remain identifiable even when the body is not JSON. Unverified reads show neither zero counts nor a live-update success label. Error cards announce errors; retry is disabled and marked busy while a read is pending.

## Files changed
- `client/src/components/owner-orders-workspace.tsx`
- `client/src/lib/owner-orders-response.ts`
- `scripts/mealscout-owner-orders-response.behavior.test.ts`
- This handoff.

## Tests/evidence already run
Sandbox Node 22.16.0 and TypeScript 5.8.3. The original workspace file was reconstructed from the connected repository and its Git blob hash exactly matched `d0590e4c40bb649477665286f981d5ff9906c1ea` before editing.

The new test file passed **40/40**, with no failures or skips: **37 response-behavior tests and 3 source-wiring contracts**. These are not browser tests. Tests exercised the real response reader with native `Response` objects. The reader and test file passed strict TypeScript compilation. The exact reader integration was separately strict-typechecked. The workspace TSX parsed and transpiled without errors; this is not a full application typecheck.

Five named functions (`describeDisputeFinancialState`, `OwnerOrderCard`, `mergeOrder`, `nextOrderStatus`, `isBusinessOrderOperator`) and both the status mutation and status-action guard were compared byte-for-byte with the base and remained unchanged. No server, schema, payment, settlement, refund, or permission code changed.

Repository test command:

```sh
node --import tsx --test scripts/mealscout-owner-orders-response.behavior.test.ts
```

Sandbox execution used strict TypeScript compilation to CommonJS followed by `node --test` because the full application dependency environment was unavailable.

### Candidate source hashes (SHA-256)
- Workspace: `d2110d0fd0b214d8380810517055da388642dd09d2f6a65bd587563cd68230ef`
- Reader: `68c0a4461ba4e5dc404e4f5bde0a57243d6dcf9617dc67b9379c46cbabf50395`
- Test: `328bc9c100fa4bf39687a3c9d3cd2198e08da468d2013fdd3546645d86e2631d`

## Changed but unverified work
Full application typecheck/build, existing browser suite, rendered mobile/desktop recovery, and live backend/provider acceptance were not run for this candidate. The authorized desktop connection returned no available device; the sandbox could not clone the repository over the network. Do not translate these bounded tests into production readiness.

## Tests/evidence invalidated by later changes
The prior head's 118 browser cases and hosted preview still describe that prior revision. They do not establish this changed workspace's browser acceptance. Run the focused integration checks below before carrying those release claims forward.

## Known blockers/risks
The reader intentionally refuses incomplete order/item rows rather than rendering a partial queue as authoritative. Confirm current server fixtures satisfy the existing owner-order field contract in real-app testing. Lost mutation responses, persisted refresh/reload mutation recovery, and other operator transitions are outside this read-only patch and remain separate acceptance work.

## External side effects and retry safety
Only source work in MealScout's draft UI/UX branch is intended. No production merge/deployment, real account creation, order mutation, payment/refund, provider activation, or infrastructure provisioning was performed. Retry remains a GET/read. Check the current branch SHA before writing; use only fast-forward updates and preserve concurrent work.

## Next exact action
At this source candidate, run the normal application typecheck/build and existing order workspace checks. Exercise owner history and kitchen in the actual app at mobile and desktop widths: valid empty queue, valid populated queue, HTTP 200 HTML/missing-orders payload, HTTP 401/403, mixed-business response, bad pagination, then valid retry. Verify error announcement, no false empty/zero/live state, no order mutation while unverified, and restored current-business orders after recovery.

## Actions that must NOT be repeated
Do not restart project discovery or reimplement the already-saved onboarding/menu-readiness slice. Do not use the old audit note as a resume point. Do not change other projects, production, financial rules, or unrelated branches to complete these checks.
