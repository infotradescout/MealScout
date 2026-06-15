# DRY Refactor Intake Checklist

Use this before touching oversized files, shared fetch layers, shared storage, route composition, dashboards, or repeated UI patterns.

## Preconditions

- [ ] Current behavior QA has been completed
- [ ] Critical/High UX bugs in the target area are fixed or explicitly accepted
- [ ] Stable behavior to preserve is written down
- [ ] Refactor scope is one module/lane, not a repo-wide cleanup
- [ ] Rollback/split strategy is clear

## Intake Questions

- What duplication is being removed?
- What user behavior must remain unchanged?
- What tests/contracts already protect it?
- What new parity test is needed?
- What manual QA must be repeated after the refactor?
- What files are explicitly out of scope?

## Allowed Refactor Shapes

- Extract one repeated helper used by a bounded surface.
- Split one oversized component while keeping props/data flow stable.
- Move route registration without changing route behavior.
- Centralize fetch handling only after current error/loading UX is documented.

## Blocked Refactor Shapes

- Broad formatting-only churn across unrelated files.
- Simultaneous refactor plus feature expansion.
- Schema or data-shape redesign without a separate approved lane.
- Removing try/catch or fallback handling without parity proof.
- Converting raw fetch calls globally without user journey QA.

