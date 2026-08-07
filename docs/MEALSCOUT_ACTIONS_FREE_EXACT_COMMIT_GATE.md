# MealScout Actions-Free Exact-Commit Gate

Status: `STEP 1 PASS — STEP 2 DONE (#328 merged)`

Scope: release order steps 1–2 closed for PR #328. Exact-commit verification
remains **not** GitHub Actions.

Owner correction (authoritative): **GitHub Actions is retired for MealScout
release evidence.** Do not chase Actions billing, do not require Actions green,
and do not bind Actions status checks to ruleset `20202108`.

Step 1 independent PASS is recorded on PR #329 (`afb5303` evidence lane).
Step 2 is **DONE**: PR #328 was squash-merged to `main` at
`0259a59231a76d75b7c341d0a5a2c47becc7e038`. This record does **not** authorize
merge of PR #329/#330/#322, does **not** deploy, and does **not** run production
migrations. **Current work:** follow PR #330 + bound search 502 (do not merge
without an explicit owner ask).

## Inventory (non-Actions verification that already exists)

| Mechanism | What it proves today | Pre-merge exact SHA? | Release evidence? |
|---|---|---|---|
| Render web service `mealscout` (`render.yaml`: `npm ci --include=dev && npm run build:platform`, auto-deploy) | Clean install + platform build on the **deployed** branch (production `main`) | No — post-merge only | Partial post-merge build proof only |
| `npm run gate:exact-commit` → `scripts/exactCommitReleaseGate.mjs` | Exact SHA + `npm ci` + typecheck + doctor + profile contracts + build; writes evidence JSON | Yes, when pinned with `EXPECTED_SHA` | **Authoritative step-1 gate** |
| `npm run check:release-readiness` → `scripts/releaseReadinessCheck.mjs` | Typecheck, mobile/store readiness, Capacitor prepare, deeplink smoke | Operator/local | Mobile/store lane; not the merge gate |
| `npm run gate:production` → `scripts/productionReadinessGate.mjs` | Env/config + optional live probes | Needs prod/env context | Later hold-lift matrix |
| Smoke scripts (`smoke:critical`, `smoke:scout-surface`, parking-pass, ordering, …) | Route/surface behavior | Operator/local | Later matrix |
| Cursor / cloud agents | Can execute any in-repo gate on a clean checkout | Yes, if tasked with clean SHA checkout | Valid **only** when evidence records the exact SHA and host label |
| `.github/workflows/ci.yml` | Historical full suite definition | N/A | **Retired** — not accepted as release evidence |

Local verification alone remains bypassable/stale. Step 1 requires an
**independent** clean run of `gate:exact-commit` against the proposed SHA, with
evidence written under `artifacts/exact-commit-gate/`.

## Chosen mechanism

**Actions-free exact-commit gate** (`scripts/exactCommitReleaseGate.mjs`).

Profiles:

| Profile | Command | Steps |
|---|---|---|
| `default` / `core` | `GATE_PROFILE=default` (or `core`) `npm run gate:exact-commit` | `npm ci --include=dev`, `check`, `doctor`, action-availability, post-merge-safety, public-data-boundary, consumer-entity-foundation, `build` |
| `pr-328` | `npm run gate:exact-commit:pr-328` (or `GATE_PROFILE=pr-328`) | `npm ci --include=dev`, `check`, `doctor`, Action API public-read projection, Action API containment, action-availability, handoff spine, `build` |

Evidence artifact:

- `artifacts/exact-commit-gate/<sha12>-<profile>.json`
- `artifacts/exact-commit-gate/latest-<profile>.json`

A run is **independent release evidence** only when:

1. `EXPECTED_SHA` is set and equals `git rev-parse HEAD`
2. `GATE_SKIP_INSTALL` is not set
3. Prefer `GATE_REQUIRE_CLEAN=1` on the independent host
4. `verdict` is `PASS` and `independentReleaseEvidence` is `true`

Ruleset `20202108` stays owner-controlled with PR + conversation resolution and
**no** required Actions status checks.

## PR #328 step 1 — independent PASS recorded

Step-1 evidence SHA (historical; #328 later squash-merged to main):

- PR: https://github.com/infotradescout/MealScout/pull/328
- Exact SHA: `a23b4579f08db689141790449be8e0326ddf3546`
- Verdict: **PASS**
- Host: `cursor-clean-worktree`
- `independentReleaseEvidence`: `true`
- Evidence (on this PR #329 branch): `artifacts/exact-commit-gate/a23b4579f08d-pr-328.json`

Independent run used path **B** (gate script from this branch on a clean
`a23b4579` checkout). GitHub Actions was not used and remains retired.

**Step 2 (release order):** **DONE** — #328 squash-merged to `main` at
`0259a59231a76d75b7c341d0a5a2c47becc7e038`. GitHub Actions remains retired.

**Current work:** follow PR #330 + bound search 502. Do not merge #329/#330,
deploy, or run production migrations without an explicit owner ask.

### How the independent run was performed (reference)

`a23b4579` does not yet contain this gate script. Path used:

**B:** On an independent clean host, check out `a23b4579`, copy only
`scripts/exactCommitReleaseGate.mjs` from this branch into that tree
(contract npm scripts already exist on that SHA), then:

```bash
EXPECTED_SHA=a23b4579f08db689141790449be8e0326ddf3546 \
GATE_PROFILE=pr-328 \
GATE_REQUIRE_CLEAN=1 \
GATE_HOST_LABEL=cursor-clean-worktree \
node scripts/exactCommitReleaseGate.mjs
```

**(A, optional later):** Merge this validation-infra PR (#329) when the owner asks,
refresh #328 onto that `main`, then re-run `npm run gate:exact-commit` on the
**new** #328 head if the SHA changes.

## What executes today vs blocked

| Item | Status |
|---|---|
| In-repo gate script + npm scripts | Executable now |
| Evidence writer | Executable now |
| Docs + hold language (Actions retired) | This PR |
| Independent hosted PASS for step 1 | **PASS** — `a23b4579` / `cursor-clean-worktree` |
| PR #328 merge (step 2) | **DONE** — squash `0259a59231a76d75b7c341d0a5a2c47becc7e038` on `main` |
| Actions billing / re-run / ruleset check binding | **Obsolete / retired — do not do** |
| Current work | Follow PR #330 + bound search 502 (no merge without owner ask) |

## Current work (not Actions billing)

Independent step-1 PASS is recorded; step-2 merge of #328 is **DONE** at
`0259a59231a76d75b7c341d0a5a2c47becc7e038`. GitHub Actions remains retired for
release evidence.

**Current work:** follow PR #330 + bound search 502. Do not merge #329/#330,
deploy, or migrate without an explicit owner ask.

Do not point production `mealscout` (`srv-d5escdh5pdvs73foo41g`) at gate work.
Do not re-run the long gate unless the evidence file is missing.

## Pass / fail for step 1

| Claim | Verdict |
|---|---|
| Actions retired for release evidence | PASS (doctrine + docs) |
| Exact-commit gate exists in-repo | PASS (this change) |
| Independent hosted PASS recorded for a proposed SHA | **PASS** — `a23b4579f08db689141790449be8e0326ddf3546` |
| Actions status checks bound on ruleset `20202108` | N/A — must remain unbound |
| Step 1 complete | **YES** — evidence at `artifacts/exact-commit-gate/a23b4579f08d-pr-328.json` |
| Step 2 (merge #328) | **DONE** — `0259a59231a76d75b7c341d0a5a2c47becc7e038` |
| Current work | Follow PR #330 + bound search 502 |
