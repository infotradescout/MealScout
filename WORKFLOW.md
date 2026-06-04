# MealScout Workflow

## Active Mode

MealScout is in cleanup/stabilization mode. Feature work is frozen.

No new product features during cleanup unless explicitly declared as a production safety prerequisite.

## Read First

1. `WORKFLOW.md`
2. `CLEANUP_MAP.md`
3. `MEALSCOUT_HANDOFF_SPINE.md`
4. `CODEBASE_PATTERNS_OVERVIEW.md`
5. `scripts/repoDoctor.mjs`

## Production Rule

No production deploy without `npm run gate:production`.

Use `SKIP_LIVE_PROBES=true npm run gate:production` only for local/dev environments where live probes are inappropriate. Production deploys should run with live probes enabled.

## Commit Discipline

- Keep commits scoped to one cleanup ticket.
- Do not mix docs, code, migrations, and generated output unless the ticket requires it.
- Do not commit live secrets, local env files, build artifacts, or unrelated formatting churn.
- Use the commit target named in `CLEANUP_MAP.md` when a ticket provides one.
- Leave the worktree clean before handing off.

## Validation Ladder

Run the narrowest relevant contract first, then the shared baseline:

1. Ticket contract, if present.
2. `node scripts/mealscout-handoff-spine.contract.test.ts`
3. `node scripts/repoDoctor.mjs`
4. `npm run gate:production`
5. `npm run check`
6. `npm run build`

For route/payment/auth changes, add the targeted route, payment, or auth smoke/contract named by the ticket.

## Cleanup Map Updates

Update `CLEANUP_MAP.md` when a cleanup ticket starts or finishes. Keep the ticket list ordered, keep status current, and add only cleanup/stabilization work.

Allowed statuses: `DONE`, `IN PROGRESS`, `NEXT`, `QUEUED`, `BLOCKED`.

## What Not To Touch Without Explicit Approval

- Live production data mutations, including booking, payment, insurance verification, payout, or user-role changes.
- Stripe webhook/payment reconciliation behavior.
- Auth/session/OAuth callback behavior.
- Database migrations or destructive schema/data operations.
- Public/private route boundary changes.
- Large frontend decomposition edits in `admin-dashboard.tsx`, `parking-pass.tsx`, or `restaurant-owner-dashboard.tsx`.
- Disallowed without explicit approval: new product features, new dashboards, new monetization flows, or new provider integrations.

When in doubt, update docs/contracts first and ask for explicit approval before mutating production state or widening scope.
