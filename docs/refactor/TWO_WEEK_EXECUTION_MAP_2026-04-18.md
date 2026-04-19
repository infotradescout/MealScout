# MealScout Refactor Execution Map (Continuation)

Date: 2026-04-18
Window: Next 10 working days
Primary objective: Continue refactor cycle with micro-slices against the two remaining oversized backend hotspots while preserving sacred flows.

## Continuation Baseline (As Of 2026-04-18)

- Prior 2026-04-15 two-week map is complete/superseded through PR-20.
- Source-of-truth progress remains:
  - `docs/refactor/REFACTOR_BOARD.md`
  - `docs/refactor/REFACTOR_METRICS_LOG.md`
- Current hotspot sizes:
  - `server/routes/adminManagementRoutes.ts`: 3914 lines
  - `server/storage.ts`: 4924 lines

## Scope And Constraints

This continuation remains constrained by:
- `docs/refactor/REFACTOR_CYCLE_GUARDRAILS.md`
- `docs/refactor/REFACTOR_BOARD.md`
- `docs/refactor/REFACTOR_METRICS_LOG.md`
- `BACKEND_HOTSPOTS.md`

Allowed lanes for this map:
- `phase-5-oversized-route-splits`
- `phase-3-storage-split`
- `phase-7-slo-protection`

Hard constraints:
- No schema redesign.
- No feature expansion.
- `IStorage` public method signatures remain unchanged.
- Route paths, middleware order, and response shapes remain unchanged.

## Success Criteria (End Of This Window)

1. `server/routes/adminManagementRoutes.ts` reduced via route-prefix extraction into focused modules.
2. `server/storage.ts` reduced via repository/module delegation for cohesive domains.
3. Sacred flows remain stable (auth/session, booking, payments/Stripe, ordering gate, mobile core).
4. Every merged slice has before/after rows in `docs/refactor/REFACTOR_METRICS_LOG.md`.
5. Board status transitions (queued -> in progress -> merged -> verified) are kept current in `docs/refactor/REFACTOR_BOARD.md`.

## Workstreams

- Workstream A: Admin route decomposition (route-prefix modules).
- Workstream B: Storage facade decomposition (domain repositories/modules).
- Workstream C: SLO protection and stabilization after each merge.

## PR Sequence (PR-21+)

### PR-21 (Day 1): Admin Email Route Extraction
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/adminManagementRoutes.ts`
- `server/routes/admin/adminEmailRoutes.ts` (new)
- `server/routes/admin/shared.ts` (reuse/extend only if needed)

Exact slice:
- Extract:
  - `GET /api/admin/email/status`
  - `POST /api/admin/email/test`
  - `GET /api/admin/email/attempts`

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-22 (Day 2): Admin LISA Remediations + Brief Actions Extraction
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/adminManagementRoutes.ts`
- `server/routes/admin/adminLisaActionsRoutes.ts` (new)

Exact slice:
- Extract:
  - `GET /api/admin/lisa/remediations`
  - `POST /api/admin/lisa/remediations`
  - `GET /api/admin/lisa/brief-actions`
  - `POST /api/admin/lisa/brief-actions`

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-23 (Day 3): Admin LISA Market Intel Routes Extraction
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/adminManagementRoutes.ts`
- `server/routes/admin/adminLisaMarketIntelRoutes.ts` (new)

Exact slice:
- Extract:
  - `GET /api/admin/lisa/market-intel`
  - `GET /api/admin/lisa/market-intel/export`

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-24 (Day 4): Storage Token Lifecycle Module Extraction
Lane: `phase-3-storage-split`

Target files:
- `server/storage.ts`
- `server/storage/tokenLifecycleRepository.ts` (new)

Exact slice:
- Extract password/phone/setup/email token lifecycle persistence methods.
- `DatabaseStorage` delegates to repository.
- `IStorage` signatures unchanged.

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-25 (Day 5): Storage Truck Live Ops Module Extraction
Lane: `phase-3-storage-split`

Target files:
- `server/storage.ts`
- `server/storage/truckLiveOpsRepository.ts` (new)

Exact slice:
- Extract truck location/session and related live ops persistence methods.
- Preserve behavior and transaction boundaries.

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-26 (Day 6): Storage Favorites/Follows/Recs Module Extraction
Lane: `phase-3-storage-split`

Target files:
- `server/storage.ts`
- `server/storage/socialPreferenceRepository.ts` (new)

Exact slice:
- Extract favorites, follows, and recommendation-related persistence methods.
- Keep call signatures and return contracts unchanged.

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-27 (Day 7): Storage Deal Feedback/Reviews Module Extraction
Lane: `phase-3-storage-split`

Target files:
- `server/storage.ts`
- `server/storage/dealFeedbackRepository.ts` (new)

Exact slice:
- Extract deal feedback, review, and associated analytics persistence methods.
- Keep behavior unchanged for existing endpoints.

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

---

### PR-28 (Day 8): Storage Host/Parking Pass Module Extraction
Lane: `phase-3-storage-split`

Target files:
- `server/storage.ts`
- `server/storage/hostParkingPassRepository.ts` (new)

Exact slice:
- Extract host/parking-pass persistence methods as a bounded cluster.
- Preserve all access checks and status transitions exactly.

Verification:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`
- `npm run smoke:critical`

---

### PR-29 (Day 9): SLO Protection + Metrics Integrity Pass
Lane: `phase-7-slo-protection`

Target files:
- `docs/refactor/REFACTOR_METRICS_LOG.md`
- `docs/refactor/REFACTOR_BOARD.md`
- `BACKEND_HOTSPOTS.md`

Exact slice:
- Ensure each PR-21..PR-28 has complete before/after rows.
- Ensure board states are consistent for all new slices.
- Refresh hotspot line-count snapshot and residual-risk notes.

Verification:
- `npm run check`
- `npm run build`
- `npm run smoke:critical`

---

### PR-30 (Day 10): Stabilization Sweep
Lane: `phase-7-slo-protection`

Target files:
- Regression-only bugfix set from PR-21..PR-29.

Exact slice:
- Resolve only regressions or contract drift found during verification.
- Keep patch small and revert-friendly.

Verification:
- `npm run check`
- `npm run build`
- `npm run test:flows:with-server`
- `npm run test:flows:e2e`

## Daily Execution Rhythm

1. Add `before` metrics row.
2. Implement one micro-slice only.
3. Run slice verification command set.
4. Add `after` metrics row.
5. Move board state.
6. Merge only when sacred-flow checks remain green.

## Reviewer Checklist (Per PR)

- Lane declared and in scope.
- No route-path or response-shape drift.
- Middleware/auth parity retained.
- No schema changes.
- `npm run check` passes.
- Slice verification commands pass.
- Metrics rows and board updates included.

## Rollback Rule

Rollback immediately on regression in:
- Auth success
- Booking completion
- Payment success
- Ordering gate success/failure ratio
- App boot success

Rollback mechanism:
- Revert the offending PR.
- Log mitigation in `docs/refactor/REFACTOR_METRICS_LOG.md`.
- Re-open as a smaller follow-up slice.

## Immediate Next Step (Today)

Start PR-21 (admin email route extraction) and keep the change constrained to route registration move only (no logic edits).
