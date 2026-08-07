# MealScout Hosted CI Blocker — August 7, 2026

Status: `BLOCKED — owner billing unlock required`

Scope: restore executable hosted GitHub Actions checks (release step 1 only).

This record does **not** claim CI PASS, does **not** authorize merge of PR #328
or #322, and does **not** bind required status checks on ruleset `20202108`.

## Root cause (confirmed)

Empty-step CI failures are **not** caused by `.github/workflows/ci.yml` syntax,
missing self-hosted runners, or job-step bugs.

GitHub check-run annotations state:

> The job was not started because your account is locked due to a billing issue.

Observed job shape for every recent CI run inspected:

| Field | Observed value |
|---|---|
| `runs-on` | `ubuntu-latest` (GitHub-hosted) |
| `runner_id` | `0` |
| `runner_name` | empty |
| `runner_group_name` | empty |
| `steps` | `[]` (zero steps executed) |
| Duration | ~2 seconds from `started_at` to `completed_at` |
| Conclusion | `failure` |

Self-hosted runner inventory (`GET /repos/infotradescout/MealScout/actions/runners`
→ `total_count: 0`) is a **red herring** for this failure mode: the workflow
requests GitHub-hosted `ubuntu-latest`, not a self-hosted label. Zero
self-hosted runners does not explain empty steps when GitHub-hosted runners are
normally available.

## Evidence samples

| Run | Context | Head SHA | Annotation |
|---|---|---|---|
| [30710537840](https://github.com/infotradescout/MealScout/actions/runs/30710537840) | `push` to `main` (`#327`) | `ec07432ea284a29373f826606c8f37210e67ab48` | account locked due to billing issue |
| [30717708199](https://github.com/infotradescout/MealScout/actions/runs/30717708199) | PR #328 draft | `a23b4579f08db689141790449be8e0326ddf3546` | account locked due to billing issue |

Commands used (read-only):

```bash
gh api repos/infotradescout/MealScout/actions/runs/30710537840/jobs \
  --jq '.jobs[0]|{conclusion,runner_id,runner_name,steps:(.steps|length),labels}'

gh api repos/infotradescout/MealScout/check-runs/91397092349/annotations
# message: "The job was not started because your account is locked due to a billing issue."

gh api repos/infotradescout/MealScout/actions/permissions
# {"enabled":true,"allowed_actions":"all","sha_pinning_required":false}

gh api users/infotradescout --jq '{login,type}'
# {"login":"infotradescout","type":"User"}
```

Repository Actions permissions are enabled. Owner account type is `User`
(`infotradescout`), not an Organization. Workflow `CI`
(`.github/workflows/ci.yml`) remains `state: active`.

Billing detail APIs returned 404 / missing `user` scope from this token and
were not used as primary evidence; the check-run annotation is sufficient.

## What was changed in this lane

Documentation only on branch `repair/restore-hosted-ci-checks` from
`origin/main` (`ec07432e`):

- This evidence file.
- Update to `docs/MEALSCOUT_RELEASE_HOLD_2026-08-01.md` blocker language.

No workflow mutation was made: changing `ci.yml` cannot start jobs while the
account is billing-locked. No ruleset change was made: required checks must not
be bound until a check name has actually executed successfully.

## Hosted run status

**No hosted run executed any workflow steps** under the current billing lock.
Checkout, install, typecheck, contracts, Playwright, and build have not run on
GitHub-hosted runners for the sampled recent failures.

## Exact next owner action

1. Sign in as the `infotradescout` account owner.
2. Open GitHub Billing and unlock the account:
   - https://github.com/settings/billing
   - Resolve the payment method / failed charge / spending limit / Actions
     billing hold that produced the lock.
3. Confirm unlock by re-running CI (do not merge yet):
   - On PR #328: `gh run rerun 30717708199` **or** push an empty commit /
     `gh workflow run` is unavailable for `pull_request`-only triggers — prefer
     `gh run rerun 30717708199` after unlock, or open/update a PR from this
     branch.
4. Pass criterion for step 1 (executable hosted checks):
   - Job has non-empty `steps`.
   - `runner_name` is non-empty.
   - First step `Checkout` appears as completed or in-progress (not
     annotation-only failure).
5. Only after at least one successful (or meaningfully executing) check run
   exists, bind that exact check name on ruleset `20202108`. Do **not** bind
   required checks while jobs still fail before start.

## Pass / fail for step 1

| Claim | Verdict |
|---|---|
| Workflow file present and active | PASS (pre-existing) |
| Repo Actions enabled | PASS |
| Root cause identified | PASS — billing account lock |
| Hosted steps actually execute | FAIL — blocked |
| Required status checks enforceable | FAIL — no successful check to bind |
| Step 1 complete | **NO** — owner billing unlock required |
