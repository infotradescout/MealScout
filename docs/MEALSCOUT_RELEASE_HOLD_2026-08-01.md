# MealScout Release Hold — August 1, 2026

Status: `PARTIAL / HOLD`

Canonical release baseline: `ec64f9082d9c346b66592fb9dfb82d93e51dd5f5`

This record supersedes earlier MealScout product-readiness summaries for the
August 1 release decision. It does not roll back `origin/main` and it does not
authorize a merge, deployment, migration, payment, provider operation, branch
deletion, or credential rotation.

## Release boundary

Until the hold is lifted, `main` accepts only release-control repairs, Action
API containment or authorization work, validation infrastructure, semantic
rescue reconciliation, independently reviewed PR #322 salvage slices, and
defects found by the exact release-validation matrix. New product surfaces and
unrelated UX, monetization, discovery, supplier, profile, category, or job work
remain outside the release lane.

## Confirmed blockers

1. GitHub Actions jobs for the current head and recent predecessors did not
   start because the repository owner's account was locked over billing. A
   triggered workflow with zero executed steps is not validation.
2. GitHub reports that `main` is not protected and the repository has no
   rulesets. Required checks and ordinary-merge bypass restrictions are not
   currently enforced.
3. Vercel reported a successful deployment for `ec64f908`; that is deployment
   evidence only, not build, browser, contract, migration, provider, payment,
   or authorization proof.
4. PR #322 is draft, conflicting, based on an older payment/delivery baseline,
   and must not be merged wholesale.
5. Static Action API integration tokens establish no user principal,
   delegation, scopes, or credential-specific attribution.
6. The rescue branch has one unique preservation commit and must remain intact
   until its semantic classification is accepted and any required behavior is
   reimplemented from current `main`.

## Current containment slice

Branch: `codex/action-api-write-containment`

Baseline: `ec64f9082d9c346b66592fb9dfb82d93e51dd5f5`

Behavior:

- `ADDED`: a fail-closed public-discovery read allowlist for static integration
  tokens.
- `REMOVED`: integration-token authority to dispatch user-scoped reads or
  writes using a submitted `userId`.
- `UNCHANGED and protected`: token authentication, public discovery reads, and
  all normal signed-in MealScout routes outside `/api/actions`.
- No environment escape hatch can re-enable integration-token writes.

Allowed actions:

- `FIND_DEALS`
- `FIND_RESTAURANTS`
- `GET_RESTAURANT_DETAILS`
- `GET_FOOD_TRUCKS`
- `GET_PARKING_PASS_SPOTS`

Every implemented user-scoped action fails before handler dispatch with HTTP
`403` and `ACTION_REQUIRES_TRUSTED_PRINCIPAL`. Reserved unimplemented actions
remain `501`; unknown names remain `400`.

## Rescue branch semantic classification

Source branch: `rescue/2026-07-28-mealscout-local-state`

Source commit: `71b7d134d99ed6b2da6e55645ad005db90a84964`

The branch remains untouched.

| File/hunk | Classification | Evidence and disposition |
|---|---|---|
| `client/src/App.tsx`: `/admin/login` and `/admin/dashboard` redirect behavior | Absorbed | Current `origin/main` still contains both redirects in guest and authenticated route groups. The rescue helper only deduplicates JSX and adds no missing behavior. Do not replay it as release repair. |
| `server/routes/admin/adminCoreOpsRoutes.ts`: replace `/admin-dashboard?...` with `/admin?...` | Still required | Current `origin/main` still emits nine `/admin-dashboard` targets, while the routed canonical admin surface is `/admin`. Extract this URL correction into a separate current-main branch with a focused route/action-link contract. |
| `server/routes/admin/adminCoreOpsRoutes.ts`: indentation near `topRecommendedActionUrl` | Obsolete | Formatting has no independent behavior and should not be carried into a semantic repair. |

No rescue hunk is classified `Conflicting` on the current evidence. The branch
must not be merged, rebased, replaced, or deleted as part of this record.

## PR #322 behavioral salvage map

Source: `repair/2026-07-28-mealscout-preview-validation` at `e897188f`.

All rows remain `PENDING EXTRACTION` until rebuilt from a fresh current-main
branch and proven independently. `server/routes/actionRoutes.ts` is explicitly
excluded from payment/delivery salvage.

| Ordered slice | Candidate owners from PR #322 | Initial disposition | Required proof boundary |
|---|---|---|---|
| 1. Schema and stateful-test foundation | `migrations/119_menu_inventory_auto_availability.sql`, `shared/schema/legacy.ts`, PostgreSQL pickup/replay fixtures | Pending retain/reject comparison | Production-like PostgreSQL apply, replay, rollback or roll-forward statement, mixed-version compatibility |
| 2. Idempotency and Stripe state transitions | `server/middleware/idempotency.ts`, `server/routes/stripeWebhookRoutes.ts`, payment cancellation/state services, webhook contracts | Pending reconciliation against free-profile main | Duplicate, stale, out-of-order and terminal-state replay; no real provider claim |
| 3. Pickup checkout and confirmation | pickup routes/pages, order confirmation, orders-workspace tests | Pending reconstruction on current checkout model | Authoritative totals, stale reconfirmation, order creation, refund and exactly-once notification behavior |
| 4. Merchant delivery lifecycle | merchant delivery route/page, eligibility/timezone services and lifecycle contract | Pending reconstruction | Merchant authority, lifecycle transitions, customer visibility, pickup interaction |
| 5. Inventory availability | migration 119 plus menu routes/schema behavior | Pending necessity check | Sold-out/zero-inventory truth, concurrency behavior and migration compatibility |
| Excluded security lane | `server/routes/actionRoutes.ts` | Reject from PR #322 salvage | Rebuild only under trusted principal/delegation authorization work |
| Incidental overlap | route map, workspace shell, package scripts, affiliate cleanup and promotion service | Pending per-hunk attribution | Retain only when required by one of the five slices; otherwise reject as unrelated or superseded |

The original PR closes without merge only after every hunk and intended
behavior is marked retained, reimplemented, superseded, or rejected with
evidence.

## Hold-lift evidence

One exact release SHA must have all of the following:

- TypeScript and production build
- full contract suite
- Chrome, Firefox, WebKit, and mobile browser coverage
- store-readiness checks
- production-like PostgreSQL migration rehearsal
- stateful Stripe duplicate, stale, and out-of-order replay
- provider sandbox and authenticated checkout validation
- pickup and merchant-delivery lifecycle validation
- cross-tenant Action API authorization negatives
- deployment pinned to the validated SHA
- controlled post-deployment smoke checks
- documented rollback or roll-forward boundaries
- executed required checks enforced through branch protection

The targeted tests previously run on `ec64f908` remain valid only for their
tested surfaces. They are one layer of release evidence, not a release verdict.
