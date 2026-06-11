# AI Parallel Execution

This repository uses parallel AI work only when each session has a clearly assigned lane. Parallel work is allowed to increase throughput, not to blur ownership.

## Authority Model

- Gawain defines doctrine, slice scope, and merge order.
- Codex implements one assigned lane per session.
- Gemini reviews and criticizes.
- Gawain reconciles Gemini criticism and issues corrected prompts.
- Gemini criticism is not optional. Treat it as required review input until Gawain accepts, rejects, or rewrites it.

## Execution Rules

- One lane per Codex session.
- One branch per lane.
- No stacked unrelated work.
- Inspect first: read the relevant files, tests, docs, and current git state before editing.
- Use the smallest safe slice that satisfies the assigned lane.
- Prefer contracts/tests before behavior changes when possible.
- Do not fake status.
- Do not fake commits.
- Do not fake test results.
- Do not import doctrine, copy, branding, or assumptions from another brand or repo.
- Do not touch files outside the assigned lane unless the need is discovered, necessary, and reported.
- Validate before commit with the repo's normal check command and any lane-specific tests.
- Do not claim tests passed unless they actually ran.
- Gawain controls merge order.

## Branch Rules

Use one branch per lane:

```text
codex/<lane-name>/<short-scope>
```

Examples:

```text
codex/public-profile/share-copy
codex/scout-discovery/no-deals-gate
codex/owner-dashboard/profile-controls
codex/docs/parallel-execution
```

Do not stack unrelated changes onto a lane branch. If a new issue appears outside the lane, report it and wait for Gawain to assign a new lane or expand the current one.

## Validation Rules

Before committing, run the normal repo validation command if it exists. For this repo, inspect `package.json` first; the current normal check command is:

```text
npm run check
```

Run lane-specific contracts or smoke tests when the lane has them. If no validation command exists for a lane, report that honestly and do not invent one.

## Commit Rules

- Commit only the assigned lane's changes.
- Use a precise commit message tied to the lane.
- Do not claim production deploy freshness from a local commit.
- Do not claim a PR exists unless it was actually opened.

## Required Return Format

Every Codex lane must return:

- repo
- lane chosen
- branch
- baseline SHA
- files inspected
- files changed
- tests run
- test results
- commit SHA if committed
- PR link if opened
- final git status
- risks / follow-up needed

