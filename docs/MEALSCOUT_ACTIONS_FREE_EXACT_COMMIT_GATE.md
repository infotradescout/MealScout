# MealScout Actions-Free Exact-Commit Gate

Status: `IMPLEMENTED IN-REPO — independent host run still required for step 1 PASS`

Scope: release order step 1 only. Restore executable **exact-commit** verification
that is **not** GitHub Actions.

Owner correction (authoritative): **GitHub Actions is retired for MealScout
release evidence.** Do not chase Actions billing, do not require Actions green,
and do not bind Actions status checks to ruleset `20202108`.

This record does **not** authorize merge of PR #328 or #322, does **not** deploy,
and does **not** run production migrations.

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

## How to validate PR #328 under this gate (before any merge)

Proposed head (do not merge without owner ask):

- PR: https://github.com/infotradescout/MealScout/pull/328
- Exact SHA: `a23b4579f08db689141790449be8e0326ddf3546`

On an **independent** clean host (not a dirty developer laptop used as the sole
proof):

```bash
git fetch origin
git checkout --detach a23b4579f08db689141790449be8e0326ddf3546
EXPECTED_SHA=a23b4579f08db689141790449be8e0326ddf3546 \
GATE_PROFILE=pr-328 \
GATE_REQUIRE_CLEAN=1 \
GATE_HOST_LABEL=independent-host \
npm run gate:exact-commit
```

Equivalent shortcut once this branch is available on the checked-out tree:

```bash
EXPECTED_SHA=a23b4579f08db689141790449be8e0326ddf3546 \
GATE_HOST_LABEL=independent-host \
npm run gate:exact-commit:pr-328
```

Record:

1. Console verdict `PASS`
2. Evidence file `artifacts/exact-commit-gate/a23b4579f08d-pr-328.json` (SHA prefix may vary with `short` form; use the written path)
3. Confirm JSON `git.headSha` equals `a23b4579f08db689141790449be8e0326ddf3546`
4. Attach or paste the evidence JSON into the PR #328 discussion / release hold update

Only after that independent PASS does release order step 2 (merge #328) become
eligible for an owner ask.

## What executes today vs blocked

| Item | Status |
|---|---|
| In-repo gate script + npm scripts | Executable now |
| Evidence writer | Executable now |
| Docs + hold language (Actions retired) | This PR |
| Independent hosted PASS for step 1 | **Blocked on one owner host action** (below) |
| PR #328 merge | Blocked until independent gate PASS + owner ask |
| Actions billing / re-run / ruleset check binding | **Obsolete — do not do** |

## ONE exact owner action (not Actions billing)

Provision or use any independent clean runner you already control (preferred:
Render one-off / SSH shell on a non-production scratch box, or a Cursor Cloud
Agent with a clean checkout — **not** GitHub Actions), then run the PR #328
commands above and attach the evidence JSON.

If you want a standing Render cron later, create it only after this gate is
proven once manually; do not point production `mealscout`
(`srv-d5escdh5pdvs73foo41g`) at gate work.

## Pass / fail for step 1

| Claim | Verdict |
|---|---|
| Actions retired for release evidence | PASS (doctrine + docs) |
| Exact-commit gate exists in-repo | PASS (this change) |
| Independent hosted PASS recorded for a proposed SHA | FAIL until owner host run |
| Actions status checks bound on ruleset `20202108` | N/A — must remain unbound |
| Step 1 complete | **NO** until independent evidence JSON shows `PASS` |
