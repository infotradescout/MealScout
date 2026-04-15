# MealScout 2-Week Refactor Execution Map

Date: 2026-04-15
Window: 10 working days (2 weeks)
Primary objective: Continue active refactor cycle with low blast radius while preserving sacred flows.

## Scope and Constraints

This plan is constrained by:
- `docs/refactor/REFACTOR_CYCLE_GUARDRAILS.md`
- `docs/refactor/REFACTOR_BOARD.md`
- `docs/refactor/REFACTOR_METRICS_LOG.md`
- `MEALSCOUT_DE_RISK_ORDER.md`

Mandatory lane mapping for all PRs in this map:
- `phase-5-oversized-route-splits`
- `phase-3-storage-split`
- `phase-7-slo-protection`

No schema redesign and no new major feature streams during this window.

## Success Criteria (End of Week 2)

1. `server/routes/adminManagementRoutes.ts` reduced via subroute extraction with stable behavior.
2. `server/routes/hostRoutes.ts` reduced via subroute extraction with stable behavior.
3. `server/routes/supplierMarketplaceRoutes.ts` reduced via subroute extraction with stable behavior.
4. `server/storage.ts` reduced by extracting payments/subscription persistence module.
5. Sacred flows remain stable (auth, booking, payments, ordering gate, mobile core).
6. Each merged PR has before/after entries in `docs/refactor/REFACTOR_METRICS_LOG.md`.

## Workstream Overview

- Workstream A (Route splits): Break oversized route modules by subdomain.
- Workstream B (Storage split): Extract payments/subscriptions query logic from storage facade.
- Workstream C (SLO protection): Verify no regressions after each slice.

## PR Sequence (File-by-File)

### PR-1 (Day 1): Admin Routes Scaffold + Non-Behavioral Move (Users)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/adminManagementRoutes.ts` (reduced orchestrator)
- `server/routes/admin/usersRoutes.ts` (new)
- `server/routes/admin/shared.ts` (new utility + dependency typing)

Exact slice:
- Extract user management endpoints from `adminManagementRoutes.ts`:
  - `GET /api/admin/users`
  - `PATCH /api/admin/users/:id/status`
  - `GET /api/admin/users/:userId/addresses`
- Keep middleware, status codes, response payloads identical.

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

Metrics log updates required:
- Add `before` + `after` rows in `docs/refactor/REFACTOR_METRICS_LOG.md`.

---

### PR-2 (Day 2): Admin Routes Split (Deals)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/adminManagementRoutes.ts`
- `server/routes/admin/dealsRoutes.ts` (new)
- `server/routes/admin/shared.ts`

Exact slice:
- Extract deal admin endpoints:
  - `GET /api/admin/deals`
  - `GET /api/admin/deals/:dealId/stats`
  - `DELETE /api/admin/deals/:dealId`
  - `POST /api/admin/deals/:dealId/clone`
  - `PATCH /api/admin/deals/:dealId/status`
  - `PATCH /api/admin/deals/:dealId/extend`

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-3 (Day 3): Admin Routes Split (Verifications + Stats)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/adminManagementRoutes.ts`
- `server/routes/admin/verificationRoutes.ts` (new)
- `server/routes/admin/statsRoutes.ts` (new)
- `server/routes/admin/shared.ts`

Exact slice:
- Extract verification and core stats endpoints:
  - `GET /api/admin/verifications`
  - `POST /api/admin/verifications/:id/approve`
  - `POST /api/admin/verifications/:id/reject`
  - `GET /api/admin/stats`
  - `POST /api/admin/subscriptions/sync`

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-4 (Day 4): Host Routes Split (Profile + Ownership)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/hostRoutes.ts`
- `server/routes/hosts/profileRoutes.ts` (new)
- `server/routes/hosts/shared.ts` (new)

Exact slice:
- Extract profile and ownership-related handlers:
  - `POST /api/hosts`
  - `GET /api/hosts/me`
- Keep ownership checks from `services/hostOwnership` unchanged.

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`
- `npm run test:flows:e2e`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-5 (Day 5): Host Routes Split (Events + Interests)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/hostRoutes.ts`
- `server/routes/hosts/eventsRoutes.ts` (new)
- `server/routes/hosts/interestsRoutes.ts` (new)
- `server/routes/hosts/shared.ts`

Exact slice:
- Extract event and interest handlers:
  - `POST /api/hosts/events`
  - `GET /api/hosts/events`
  - `PATCH /api/hosts/events/:eventId`
  - `PATCH /api/hosts/interests/:interestId/status`
  - `GET /api/hosts/events/:eventId/interests`

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`
- `npm run smoke:critical`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-6 (Day 6): Supplier Marketplace Split (Catalog + Suppliers)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/supplierMarketplaceRoutes.ts`
- `server/routes/suppliers/catalogRoutes.ts` (new)
- `server/routes/suppliers/shared.ts` (new)

Exact slice:
- Extract supplier listing/detail/catalog read endpoints from marketplace monolith.
- Keep path compatibility and response shape stable.

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:flows:with-server`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-7 (Day 7): Supplier Marketplace Split (Orders + Payments)
Lane: `phase-5-oversized-route-splits`

Target files:
- `server/routes/supplierMarketplaceRoutes.ts`
- `server/routes/suppliers/ordersRoutes.ts` (new)
- `server/routes/suppliers/paymentsRoutes.ts` (new)
- `server/routes/suppliers/shared.ts`

Exact slice:
- Extract order placement/state and payment-intent flow endpoints.
- Preserve payment webhooks and order lifecycle semantics.

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:supplier-payments`
- `npm run test:supplier-pay-intent-switch`
- `npm run test:flows:with-server`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-8 (Day 8): Storage Split (Payments/Subscriptions Repository)
Lane: `phase-3-storage-split`

Target files:
- `server/storage.ts`
- `server/storage/paymentsSubscriptionsRepository.ts` (new)
- `server/storage/shared.ts` (if needed for common helpers)

Exact slice:
- Move payments/subscription persistence methods out of `storage.ts` into dedicated module.
- `IStorage` method signatures must remain unchanged.
- `DatabaseStorage` delegates to new repository.

Verification commands:
- `npm run check`
- `npm run build:server`
- `npm run test:ordering-subscription-scope`
- `npm run smoke:ordering-subscription-access`
- `npm run test:supplier-payments`

Metrics log updates required:
- Add `before` + `after` rows.

---

### PR-9 (Day 9): SLO Protection Pass + Guardrail Hardening
Lane: `phase-7-slo-protection`

Target files:
- `docs/refactor/REFACTOR_METRICS_LOG.md`
- `docs/refactor/REFACTOR_BOARD.md`
- `BACKEND_HOTSPOTS.md`

Exact slice:
- Populate missing before/after metric snapshots for all merged PRs.
- Update board states: queued -> in progress -> merged -> verified.
- Refresh hotspots note with post-split status and remaining large-file targets.

Verification commands:
- `npm run check`
- `npm run build`
- `npm run smoke:critical`

Evidence:
- Attach dashboard extracts/links in metrics notes.

---

### PR-10 (Day 10): Stabilization and Sweep
Lane: `phase-7-slo-protection`

Target files:
- Small bugfix set only, constrained to regressions found in PR-1..PR-9.
- No new feature files.

Exact slice:
- Resolve residual routing mismatches, middleware ordering issues, or response-shape drift.
- Keep this PR small and revert-friendly.

Verification commands:
- `npm run check`
- `npm run build`
- `npm run test:flows:with-server`
- `npm run test:flows:e2e`

Release readiness checklist:
- Auth/session smoke OK
- Booking flow smoke OK
- Payment/Stripe smoke OK
- Ordering gate smoke OK
- Mobile core routes smoke OK

## Daily Execution Rhythm

Each day follows the same sequence:
1. Capture pre-change metrics row in `docs/refactor/REFACTOR_METRICS_LOG.md`.
2. Implement one PR slice only.
3. Run verification command set for that slice.
4. Capture post-change metrics row.
5. Update `docs/refactor/REFACTOR_BOARD.md` status.
6. Merge only if sacred flow checks remain green.

## Reviewer Checklist (Copy into PR template)

- Lane declared and valid for cycle scope.
- Paths and response shapes unchanged for extracted endpoints.
- Auth middleware parity confirmed before/after.
- No schema changes.
- `npm run check` passes.
- Slice-specific tests pass.
- Metrics log before/after entries added.

## Rollback Rule

Rollback immediately if any of these regress:
- Auth success
- Booking completion
- Payment success
- Ordering gate success/failure ratio
- App boot success

Rollback mechanism:
- Revert offending PR cleanly.
- Log regression and mitigation in `docs/refactor/REFACTOR_METRICS_LOG.md` notes.
- Re-open slice as smaller follow-up PR.

## Immediate Next Step (Today)

Start PR-1 from this map and keep scope to users endpoints only. Do not begin PR-2 until PR-1 is merged and metrics are recorded.
