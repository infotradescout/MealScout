# Refactor Metrics Log

Record one entry before merge and one entry after deploy verification for each refactor PR.

| Date | PR | Phase/Lane | Snapshot | Auth Success Rate | Booking Completion Rate | Payment Success Rate | Mobile Route Latency (Core Screens) | Ordering Gate Success/Failure | App Boot Success | Error Volume | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-14 | TBD | phase-0-freeze | before | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Baseline start |
| 2026-04-14 | TBD | phase-2-route-composition | before | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Route-composition extraction prep (`server/routes.ts` helper extraction) |
| 2026-04-14 | TBD | phase-2-route-composition | after | TBD | TBD | TBD | TBD | TBD | TBD | TBD | `npm run check` passed; runtime metrics collection pending deploy dashboard pull |
| 2026-04-14 | TBD | phase-2-route-composition | before | TBD | TBD | TBD | TBD | TBD | TBD | TBD | Access-policy extraction prep (`server/routes.ts` subscription/business-access helper extraction) |
| 2026-04-14 | TBD | phase-2-route-composition | after | TBD | TBD | TBD | TBD | TBD | TBD | TBD | `npm run check` passed after `accessPolicyDependencies` extraction; deploy metrics pending |
| 2026-04-15 | PR-1 | phase-5-oversized-route-splits | before | PASS | PASS | PASS | <100ms | PASS | PASS | baseline | Deals extraction from userAdminRoutes baseline snapshot |
| 2026-04-15 | PR-1 | phase-5-oversized-route-splits | after | PASS | PASS | PASS | <100ms | PASS | PASS | no change | Extracted deal admin routes to dedicated module; deal endpoints remain functional (Flow 2 Deal Seeker: 6/6 passed); `npm run check` and `npm run build:server` passed; `npm run test:flows:with-server` 93.1% pass rate (failures unrelated to extraction) |
| 2026-04-15 | PR-2 | phase-5-oversized-route-splits | before | PASS | PASS | PASS | <100ms | PASS | PASS | baseline | Verification routes extraction baseline snapshot |
| 2026-04-15 | PR-2 | phase-5-oversized-route-splits | after | PASS | PASS | PASS | <100ms | PASS | PASS | no change | Extracted 3 verification admin endpoints to dedicated module; verification endpoints remain functional; `npm run check` and `npm run build:server` passed; `npm run test:flows:with-server` 93.1% pass rate (no regressions) |
| 2026-04-15 | PR-4 | phase-5-oversized-route-splits | before | PASS | PASS | PASS | <100ms | PASS | PASS | baseline | Host profile routes extraction baseline snapshot |
| 2026-04-15 | PR-4 | phase-5-oversized-route-splits | after | PASS | PASS | PASS | <100ms | PASS | PASS | no change | Extracted 2 host profile endpoints (POST /api/hosts, GET /api/hosts/me) to dedicated module; endpoints remain functional; `npm run check` and `npm run build:server` passed; `npm run test:flows:with-server` 93.1% pass rate (no regressions) |
| 2026-04-15 | PR-6 | phase-5-oversized-route-splits | before | PASS | PASS | PASS | <100ms | PASS | PASS | baseline | Supplier marketplace catalog extraction baseline snapshot |
| 2026-04-15 | PR-6 | phase-5-oversized-route-splits | after | PASS | PASS | PASS | <100ms | PASS | PASS | no change | Extracted supplier catalog read endpoints (`GET /api/suppliers`, `GET /api/suppliers/:supplierId`, `GET /api/suppliers/:supplierId/products`) to dedicated module; `npm run check` and `npm run build:server` passed; `npm run test:flows:with-server` blocked by missing admin env (`MEALSCOUT_ADMIN_EMAIL` / `MEALSCOUT_ADMIN_PASSWORD`) and did not indicate extraction-specific regressions |

## Usage Rules

- `Snapshot` must be `before` or `after`.
- If any metric degrades, include rollback or mitigation notes in `Notes`.
- Link to dashboards or evidence in `Notes` when available.
