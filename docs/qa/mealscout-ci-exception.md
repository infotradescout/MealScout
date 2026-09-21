# MealScout PR #380: owner-directed CI exception

The owner directed “skip the check then” after the GitHub Actions `check` job was shown to have executed no steps because of an account billing lock.

For this MealScout PR/release continuation, do not wait for that billing-blocked job or treat its non-execution as an implementation blocker. Preserve the recorded failure instead of representing it as a passing test. The exception is limited to that unavailable GitHub job and its reruns for this continuation; it does not remove repository protections globally.

Continue from the existing task branch and current source-bound local/hosted evidence. Do not change billing or access settings. Do not waive failed application tests, database migration/worker compatibility, financial safeguards or connected-provider acceptance. No production merge or deployment is performed by recording this exception.

Starting revision: `e7dc7b668e1ea2aa76341f428b3847e750f86856`.
Owning branch: `codex/ui-ux-front-end-overhaul-20260915`.
PR discussion receipt: comment `5746995133`.
Latest source handoff at entry: `docs/product/MEALSCOUT_SECURITY_HANDOFF_2026-09-19.md`.

Next implementation boundary: native PostgreSQL migration 142 and separate-process Parking Pass durability/expiry verification using disposable data only. Existing accepted product scope and completed work remain unchanged.

## Executable scope

The `check` job now has a job-level condition limited to PR380 from the exact MealScout repository and existing task branch. Main pushes, every other PR and forks keep the unchanged job steps. This uses an explicit skipped job rather than deleting the workflow, changing branch protection, or manufacturing a passing test result. A fresh GitHub check-run observation is required before claiming the platform itself marked it skipped.
