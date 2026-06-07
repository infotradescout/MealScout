# MealScout Cleanup Map

This map is the cleanup authority. Work tickets in order unless production safety requires a narrow exception.

## Production Incident Follow-Ups

### Blessed Berry Bowls Parking Pass Routing

Status: `CODE-FIXED / CONDITIONALLY RESOLVED`

Production commit: `aadf0816` - `fix: repair blessed berry bowls parking pass routing`.

Current evidence:

- Production `/api/version` reported `aadf08167daa09a38bf572547685010811cf5cce`.
- Schedule-required `food_truck` continuation now targets `/restaurant-owner-dashboard?setup=schedule`.
- Safe route checks confirmed `/restaurant-owner-dashboard?setup=schedule` returns `200`.
- Safe route checks confirmed `/parking-pass-manage` still returns `200` for existing host-oriented behavior.
- `scripts/mealscout-blessed-berry-routing-parking-pass.contract.test.ts` passed.
- No host rows, roles, pricing, payout logic, affiliate logic, insurance verification, or Parking Pass host behavior were changed.

Remaining limitation: Direct Blessed Berry authenticated smoke is unavailable because we cannot log in as that customer account.

Reopen condition: If Blessed Berry reports the issue again after `aadf0816`, capture the actual post-login URL and reopen as a targeted login continuation bug.

Cleanup status: Do not block cleanup indefinitely on the unavailable customer login; resume from the next cleanup item.

## C1 - MealScout Handoff Spine

Status: `DONE`

Goal: Make MealScout understandable to a competent developer in one day.

Files likely touched: `MEALSCOUT_HANDOFF_SPINE.md`, `scripts/mealscout-handoff-spine.contract.test.ts`.

Allowed changes: Documentation and contract updates that reflect current production truth.

Disallowed changes: Feature work, route rewrites, schema changes, or cleanup implementation beyond the spine.

Validation command: `node scripts/mealscout-handoff-spine.contract.test.ts`.

Handoff value: A developer knows what MealScout is, where the major surfaces live, what is dangerous, and how to validate changes.

## C2 - Restore Cleanup Map Authority

Status: `DONE`

Goal: Restore canonical cleanup workflow docs so the next developer knows process, order, freeze rules, and validation.

Files likely touched: `WORKFLOW.md`, `CLEANUP_MAP.md`, `scripts/mealscout-cleanup-map-authority.contract.test.ts`.

Allowed changes: Short authoritative workflow/map docs and a contract test that prevents them from disappearing or drifting.

Disallowed changes: New product features, code decomposition, route changes, schema changes, production data mutations.

Validation command: `node scripts/mealscout-cleanup-map-authority.contract.test.ts`.

Handoff value: The repo has one obvious cleanup operating path and one ordered ticket list.

## C3 - Route Map Consolidation

Status: `DONE`

Goal: Reconcile `ROUTES_MAP.md`, `client/src/App.tsx`, `server/routes.ts`, and public/private route prefixes into one maintained route map.

Files likely touched: `ROUTES_MAP.md`, `client/src/App.tsx`, `server/routes.ts`, route contract scripts.

Allowed changes: Documentation, route inventory, static contracts, and low-risk naming clarifications.

Disallowed changes: Moving routes, changing auth behavior, deleting legacy routes, or changing SPA fallback behavior.

Validation command: `node scripts/mealscout-route-map.contract.test.ts`.

Handoff value: A developer can find public, owner, host, admin, and mobile route boundaries without reverse-engineering the app.

## C4 - Admin Dashboard Decomposition Map

Status: `DONE`

Goal: Map `client/src/pages/admin-dashboard.tsx` into extraction zones without changing behavior.

Files likely touched: `MEALSCOUT_ADMIN_DASHBOARD_DECOMPOSITION_MAP.md`, `scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`, `client/src/pages/admin-dashboard.tsx` only for read-only references if needed.

Allowed changes: Documentation, static analysis, contract tests around existing tabs and API calls.

Disallowed changes: Component extraction, visual redesign, API behavior changes, or admin permission changes.

Validation command: `node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`.

Handoff value: A developer knows how to split the admin dashboard safely later.

## C5 - Launch Board SQL Safety Map

Status: `DONE`

Goal: Document and guard Launch Board SQL/select assumptions against schema drift.

Files likely touched: `MEALSCOUT_LAUNCH_BOARD_SQL_SAFETY_MAP.md`, `scripts/mealscout-launch-board-sql-safety-map.contract.test.ts`, `server/routes/admin/adminCoreOpsRoutes.ts` only for read-only references if needed.

Allowed changes: Static contracts, documentation, and narrow safety checks for existing references.

Disallowed changes: Metric redesign, query rewrites, new Launch Board features, or data backfills.

Validation command: `node scripts/mealscout-launch-board-sql-safety-map.contract.test.ts`.

Handoff value: Launch Board changes have a schema-safety checklist before cleanup starts.

## C5A - MealScout Email + Copy Audit

Status: `DONE`

Goal: Audit automated MealScout email/user-facing notification copy and correct production-risky brand/deal activation claims.

Files likely touched: `MEALSCOUT_EMAIL_COPY_AUDIT.md`, `scripts/mealscout-email-copy-audit.contract.test.ts`, email/template source files such as `server/restaurantActivationService.ts`.

Allowed changes: Documentation, static copy contracts, and narrow production-correctness copy fixes.

Disallowed changes: New product features, new email campaigns, provider changes, scheduler behavior changes, or live email sends.

Validation command: `node scripts/mealscout-email-copy-audit.contract.test.ts`.

Handoff value: A developer knows which automated emails exist, what claims are allowed, and which copy regressions are blocked.

## C5B - Code-Derived Role + Admin Display Audit

Status: `DONE`

Goal: Audit code-derived role values and correct admin display assumptions for business attachment, affiliate links, role dropdowns, and Parking Pass access boundaries.

Files likely touched: `MEALSCOUT_ROLE_ADMIN_DISPLAY_AUDIT.md`, `client/src/pages/admin-dashboard.tsx`, `client/src/hooks/useAuth.ts`, admin provisioning routes, role/display contract scripts, `CLEANUP_MAP.md`.

Allowed changes: Code-derived role inventory, narrow production-correctness admin UI fixes, canonical userType alignment, Parking Pass access guard correction, static contracts, and cleanup map documentation.

Disallowed changes: New roles, renamed database values without compatibility handling, new admin features, new subscription flows, payout/attribution logic changes, schema changes, or live admin mutations.

Validation command: `node scripts/mealscout-role-admin-display-audit.contract.test.ts`.

Handoff value: Admin operators see code-derived roles and usable assets instead of stale role assumptions or internal tokens.

## C5C - Affiliate Link Display Correction

Status: `DONE`

Goal: Correct admin user detail display so affiliate tags render as full shareable MealScout referral links.

Files likely touched: `client/src/pages/admin-dashboard.tsx`, `scripts/mealscout-affiliate-link-display.contract.test.ts`, `CLEANUP_MAP.md`.

Allowed changes: Narrow display-only admin UI correction, canonical referral URL formatting, copy/open controls, and static contracts.

Disallowed changes: Attribution logic changes, payout changes, fake tag generation, new affiliate features, schema changes, or live provider mutations.

Validation command: `node scripts/mealscout-affiliate-link-display.contract.test.ts`.

Handoff value: Admin operators see the usable referral asset instead of an internal token.

## C6 - Parking Pass Page Decomposition Map

Status: `DONE`

Goal: Map `client/src/pages/parking-pass.tsx` modes, API calls, state clusters, and extraction order.

Files likely touched: `MEALSCOUT_PARKING_PASS_DECOMPOSITION_MAP.md`, `scripts/mealscout-parking-pass-decomposition-map.contract.test.ts`, `client/src/pages/parking-pass.tsx` only for read-only references if needed.

Allowed changes: Documentation, static contracts, and read-only inventories.

Disallowed changes: Booking behavior changes, payment changes, host availability changes, live booking mutations.

Validation command: `node scripts/mealscout-parking-pass-decomposition-map.contract.test.ts`.

Handoff value: A developer knows the safe extraction order for Parking Pass without breaking booking.

## C7 - Owner Dashboard Decomposition Map

Status: `DONE`

Goal: Map `client/src/pages/restaurant-owner-dashboard.tsx` owner/truck/profile/menu/schedule concerns and extraction order.

Files likely touched: `MEALSCOUT_OWNER_DASHBOARD_DECOMPOSITION_MAP.md`, `scripts/mealscout-owner-dashboard-decomposition-map.contract.test.ts`, `client/src/pages/restaurant-owner-dashboard.tsx` only for read-only references if needed.

Allowed changes: Documentation, static contracts, and read-only inventories.

Disallowed changes: Owner access changes, profile save behavior changes, menu writes, schedule writes, or subscription gating changes.

Validation command: `node scripts/mealscout-owner-dashboard-decomposition-map.contract.test.ts`.

Handoff value: Owner dashboard cleanup can proceed in small verified slices.

## C8 - Public/Auth Route Boundary Audit

Status: `DONE`

Goal: Verify guest/authenticated frontend routes, public route prefixes, and server auth middleware alignment.

Files touched: `MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md`, `scripts/mealscout-public-auth-route-boundary-audit.contract.test.ts`, `CLEANUP_MAP.md`.

Allowed changes: Documentation, static contracts, and route boundary inventories.

Disallowed changes: Auth middleware behavior, public route expansion, admin/staff route exposure, OAuth callback changes.

Validation command: `node scripts/mealscout-public-auth-route-boundary-audit.contract.test.ts` and `npm run gate:production`.

Handoff value: Public/private access boundaries are explicit before cleanup moves code. No hard public/auth boundary mismatch was found in C8. C9 Payment/Webhook Safety Map and C10 Production Smoke Fixture Plan remain queued.

## C9A - Account Lifecycle + Discovery Boundary Audit

Status: `DONE`

Goal: Document the existing account lifecycle, public discovery, referral, setup, verification, login recovery, dashboard continuation, and Parking Pass boundary map without runtime changes.

Files touched: `MEALSCOUT_ACCOUNT_LIFECYCLE_DISCOVERY_AUDIT.md`, `scripts/mealscout-account-lifecycle-discovery-audit.contract.test.ts`, `CLEANUP_MAP.md`.

Allowed changes: Documentation and static contract only.

Disallowed changes: Runtime behavior, auth middleware, routes, role names, onboarding, registration, affiliate behavior, Parking Pass behavior, payment behavior, or sample data.

Validation command: `node scripts/mealscout-account-lifecycle-discovery-audit.contract.test.ts`.

Handoff value: Inserted stabilization audit; C8 remains `NEXT` and can still perform the public/auth route boundary audit. The queued payment/webhook safety map remains queued and is not renamed, advanced, or implied complete by this docs-only audit.

## C9 - Payment/Webhook Safety Map

Status: `DONE`

Goal: Document and guard Stripe booking, subscription, supplier, pickup order, payout, and webhook reconciliation paths.

Files touched: `MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md`, `scripts/mealscout-payment-webhook-safety-map.contract.test.ts`, `CLEANUP_MAP.md`.

Allowed changes: Documentation, static contracts, read-only smoke plans.

Disallowed changes: Payment intent creation, webhook mutation logic, payout math, live Stripe calls that mutate provider state.

Validation command: `node scripts/mealscout-payment-webhook-safety-map.contract.test.ts` and `npm run gate:production`.

Handoff value: Payment cleanup has an explicit safety map before any code moves. Follow-ups are documented as audit findings only; C10 remains queued for production smoke fixture planning.

## C10 - Production Smoke Fixture Plan

Status: `QUEUED`

Goal: Define safe staging or explicit production test fixtures for stateful admin insurance and booking allowed/blocked smokes.

Files likely touched: smoke test docs/contracts, fixture plan docs.

Allowed changes: Fixture documentation, read-only fixture discovery, contract placeholders.

Disallowed changes: Live production booking mutations, live insurance verification mutations, ad hoc user/payment creation.

Validation command: `node scripts/mealscout-cleanup-map-authority.contract.test.ts`.

Handoff value: Future stateful smokes are safe, repeatable, and approved before they touch production.
