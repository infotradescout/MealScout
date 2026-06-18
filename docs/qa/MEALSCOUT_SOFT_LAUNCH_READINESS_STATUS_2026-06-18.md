Status: Soft launch ready for controlled rollout.

# MealScout Soft Launch Readiness Status — 2026-06-18

## Production SHA

- Current production `main` SHA: `537ff047aa444fee06a05ac41ba7da711abde63a`

## Cleared Blockers

- Public truck schedule-state contradiction cleared.
- Free Profile signup/legal gate cleared.
- Production `/api/version` marker repaired.

## Legal-Gate Live Proof

- `Terms of Service` is visible on the public food truck signup shell.
- `Privacy Policy` is visible on the public food truck signup shell.
- `Continue with Google` is blocked until terms are accepted.
- Server rejects `acceptTerms:false` with `400` and `You must accept the terms`.

## Schedule-State Live Proof

The following affected truck profiles passed live smoke without showing contradictory schedule signals:

- `3D Eats & Tea`
- `Sweet Love`
- `All Gas No Brakes Reloaded`
- `CREATIVBOWLS`
- `Jays Southern Cuisine`

## Version Endpoint Live Proof

Live `/api/version` response now reports explicit deployment metadata:

- `platform`: `render`
- `commit`: `537ff047aa444fee06a05ac41ba7da711abde63a`
- `commitSource`: `RENDER_GIT_COMMIT`
- `buildTimeSource`: `serverStartedAt`

This fixes the misleading stale SHA issue without treating Vercel and Render as the same deployment surface.

## Known Non-Blocking Limitations

- Incomplete truck profile content remains content/onboarding work.
- Not every truck has complete menus, schedules, logos, or covers.
- These are normal completion gaps, not launch blockers.
- Do not claim fake completeness.

## Recommended Next Operational Lane

Soft launch owner/operator execution:

- invite controlled users
- onboard or verify more truck content
- collect real usage signals
- fix only user-facing issues found in live use

## Scope Note

- No runtime code changed in this status lane.
- No production data changed in this status lane.
- Do not restart legal or schedule remediation unless a live regression appears.
