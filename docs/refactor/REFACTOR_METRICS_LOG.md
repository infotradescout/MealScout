# Refactor Metrics Log

Record one entry before merge and one entry after deploy verification for each refactor PR.

| Date | PR | Phase/Lane | Snapshot | Auth Success Rate | Booking Completion Rate | Payment Success Rate | Mobile Route Latency (Core Screens) | Ordering Gate Success/Failure | App Boot Success | Error Volume | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-14 | TBD | phase-0-freeze | before | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Baseline start |
| 2026-04-14 | TBD | phase-2-route-composition | before | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Route-composition extraction prep (`server/routes.ts` helper extraction) |
| 2026-04-14 | TBD | phase-2-route-composition | after | TBD | TBD | TBD | TBD | TBD | TBD | TBD | `npm run check` passed; runtime metrics collection pending deploy dashboard pull |
| 2026-04-14 | TBD | phase-2-route-composition | before | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Access-policy extraction prep (`server/routes.ts` subscription/business-access helper extraction) |
| 2026-04-14 | TBD | phase-2-route-composition | after | TBD | TBD | TBD | TBD | TBD | TBD | TBD | `npm run check` passed after `accessPolicyDependencies` extraction; deploy metrics pending |

## Usage Rules

- `Snapshot` must be `before` or `after`.
- If any metric degrades, include rollback or mitigation notes in `Notes`.
- Link to dashboards or evidence in `Notes` when available.
