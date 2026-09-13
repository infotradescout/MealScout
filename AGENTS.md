# AGENTS.md — MealScout

MealScout uses Selective Intelligence as the mandatory execution model. The canonical skill is `.agents/skills/selective-intelligence/`.

## Resume-first execution

Optimize for verified forward progress per unit of context, reasoning, tool use, and validation cost.

Before broad inspection, planning from scratch, or repository-wide validation:

1. Load the latest authoritative checkpoint/handoff and current branch/commit.
2. Read only the governing product/feature docs and evidence required for the assigned slice.
3. Resume from the first unproven state transition.
4. Do not restart an audit, roadmap, repository map, or already-proven work merely because a new chat, Work task, model, or agent started.

Rules:

- Resume before rediscovering.
- Prefer search, diffs, exact ranges, and prior evidence over rereading large files.
- Inspect the smallest relevant surface first and expand only when dependencies or shared-owner impact require it.
- Use targeted validation during implementation. Run broad/full gates at integration, release readiness, or when shared-contract changes invalidate prior evidence.
- Parallel lanes must have explicit ownership/integration boundaries and share authoritative state instead of independently rebuilding context.
- When capacity is constrained, preserve implementation lanes and defer duplicate audits, speculative exploration, repeated broad reviews, and non-blocking prose.
- Before an interrupted run yields, persist a resumable checkpoint whenever write access remains available.

Every checkpoint/handoff must include:

```text
Objective:
Base branch/commit:
Current branch/commit:
Verified completed work:
Changed but unverified work:
Files changed:
Tests/evidence already run:
Tests/evidence invalidated by later changes:
Known blockers/risks:
External side effects and retry safety:
Next exact action:
Actions that must NOT be repeated:
```

Use `.agents/skills/selective-intelligence/references/continuity-and-impact.md` for interruption, parallel work, handoff, and idempotent resume rules. Use `.agents/skills/selective-intelligence/references/model-neutral-execution.md` for the portable execution contract.

A fresh session is not a fresh project. It must verify the minimum state needed to continue safely, then execute.
