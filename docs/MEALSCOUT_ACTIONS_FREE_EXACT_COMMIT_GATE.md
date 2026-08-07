# MealScout Actions-Free Exact-Commit Gate

Status: `STEP 1 INDEPENDENT PASS — waiting on owner to authorize merge of #328`

Scope: release order step 1 only. Restore executable **exact-commit** verification
that is **not** GitHub Actions.

Owner correction (authoritative): **GitHub Actions is retired for MealScout
release evidence.** Do not chase Actions billing, do not require Actions green,
and do not bind Actions status checks to ruleset `20202108`.

This record does **not** authorize merge of PR #328 or #322, does **not** deploy,
and does **not** run production migrations. **Next step:** owner-authorized merge of
PR #328 (do not merge without an explicit owner ask).

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

Proposed head (do not merge without owner ask):

- PR: https://github.com/infotradescout/MealScout/pull/328
- Exact SHA: `a23b4579f08db689141790449be8e0326ddf3546`
- Verdict: **PASS**
- Host: `cursor-clean-worktree`
- `independentReleaseEvidence`: `true`
- Evidence (on this PR #329 branch): `artifacts/exact-commit-gate/a23b4579f08d-pr-328.json`

Independent run used path **B** (gate script from this branch on a clean
`a23b4579` checkout). GitHub Actions was not used and remains retired.

**Next step (release order step 2):** waiting on owner to authorize merge of #328.
Do not merge, deploy, or run production migrations without that ask.

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
| PR #328 merge | **Waiting on owner authorize** (do not merge without ask) |
| Actions billing / re-run / ruleset check binding | **Obsolete — do not do** |

## ONE exact owner action (not Actions billing)

Independent step-1 PASS is already recorded. The remaining owner action is:
**authorize merge of PR #328** (explicit ask). Do not merge, deploy, or migrate
until that authorization.

Do not point production `mealscout` (`srv-d5escdh5pdvs73foo41g`) at gate work.
Do not re-run the long gate unless the evidence file is missing or the #328 SHA
changes.

## Pass / fail for step 1

| Claim | Verdict |
|---|---|
| Actions retired for release evidence | PASS (doctrine + docs) |
| Exact-commit gate exists in-repo | PASS (this change) |
| Independent hosted PASS recorded for a proposed SHA | **PASS** — `a23b4579f08db689141790449be8e0326ddf3546` |
| Actions status checks bound on ruleset `20202108` | N/A — must remain unbound |
| Step 1 complete | **YES** — evidence at `artifacts/exact-commit-gate/a23b4579f08d-pr-328.json` |
| Step 2 (merge #328) | **Waiting on owner authorize** |
