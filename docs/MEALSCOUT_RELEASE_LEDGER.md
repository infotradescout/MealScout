# MealScout Release Ledger

> **Current governing release state:** [`MEALSCOUT_RELEASE_HOLD_2026-08-01.md`](./MEALSCOUT_RELEASE_HOLD_2026-08-01.md) supersedes the historical readiness labels below for the August 1, 2026 release decision. Current verdict: `PARTIAL / HOLD`.
>
> **Step 1 verification:** GitHub Actions is retired for MealScout release evidence. Use the Actions-free exact-commit gate: [`MEALSCOUT_ACTIONS_FREE_EXACT_COMMIT_GATE.md`](./MEALSCOUT_ACTIONS_FREE_EXACT_COMMIT_GATE.md).

Last updated: 2026-08-07 (America/Chicago)

## Locked release stack

1. Business Profile v1.1
- Status: RELEASE-READY
- Commit: `367c4921`
- Validation: pass (build/check/routes), owner-facing profile operations live

2. Owner Value Dashboard v1
- Status: RELEASE-READY
- Commit: `367c4921`
- Validation: static contract + runtime integration proof locked, build/check/test/routes pass

3. Profile Completion Engine v2
- Status: RELEASE-READY
- Commit: `4ffc6649`
- Validation: contract/check/test/build/verify:routes pass

4. Public SEO Landing Pages
- Status: RELEASE-READY
- Commit: `5f8e66d0`
- Validation: contract/check/test/build/verify:routes pass

5. Public SEO Live Smoke
- Status: PASS
- Runtime mode: `npm run start:local` on port `5200`
- Validation: SEO API routes 200, page routes 200 HTML, no shell errors, canonical `/p/...` links confirmed

6. Public Discovery Analytics
- Status: RELEASE-READY
- Commit: `e16601e8`
- Validation: `public-discovery-analytics.contract` + check/test/build/verify:routes pass

7. PDA-2.1 DB-Seeded Runtime Integration Contract
- Status: PASS
- Commit: `7bde6679`
- Validation:
  - `npm run test -- public-discovery-analytics.integration` ✅
  - `npm run test -- public-discovery-analytics.contract` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅

8. PDA-2.2 Owner Value + Discovery Attribution Aggregate
- Status: PASS
- Commit: `7bde6679`
- Validation:
  - `npm run test -- owner-value-attribution` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅

9. PDA-2.3 Owner Analytics UI Consumption Contract
- Status: PASS
- Commit: `e434d577`
- Target endpoint: `GET /api/owner/value-attribution?window=7d|30d`
- Depends on: PDA-2.1, PDA-2.2
- Validation:
  - `npm run test -- owner-value-attribution-ui` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅
- Remaining non-blocking hardening:
  - DB-seeded browser/runtime UI proof deferred to PDA-2.4

10. PDA-2.4 DB-Seeded Owner Analytics Browser Proof
- Status: PASS
- Commit: `3088b923`
- Depends on:
  - PDA-2.1 — DB-seeded runtime integration contract
  - PDA-2.2 — Owner value attribution aggregate
  - PDA-2.3 — Owner analytics UI consumption contract
- Goal:
  - Prove seeded owner attribution data renders in the authenticated owner dashboard without leaking unrelated owner/entity analytics.
- Validation:
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅
- Proof:
  - Authenticated owner dashboard renders DB-seeded attribution values.
  - 7d and 30d windows request and render distinct values.
  - Outsider entity/activity does not leak.
  - Empty-state owner renders safe zero-activity copy.

11. PDA-2.5 Owner Value Messaging + Conversion Surface
- Status: PASS
- Commit: `9ff6dc8f`
- Depends on:
  - PDA-2.1 — DB-seeded runtime integration contract
  - PDA-2.2 — Owner value attribution aggregate
  - PDA-2.3 — Owner analytics UI consumption contract
  - PDA-2.4 — DB-seeded owner analytics browser proof
- Goal:
  - Convert owner attribution analytics into clear, measured owner-facing guidance that encourages profile completion and repeat dashboard usage without inflated claims.
- Validation:
  - `npm run test -- owner-value-messaging` ✅
  - `npm run test -- owner-value-attribution-ui` ✅
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅
- Proof:
  - Attribution panel includes measured owner-facing value framing and completion CTAs.
  - Authenticated browser path renders messaging and conversion buttons with DB-seeded attribution data.
  - Copy avoids inflated ranking/superiority claims.

12. PDA-2.6 Owner Profile Completion Loop
- Status: PASS
- Commit: `7661a7ca`
- Depends on:
  - PDA-2.1 — DB-seeded runtime integration contract
  - PDA-2.2 — Owner value attribution aggregate
  - PDA-2.3 — Owner analytics UI consumption contract
  - PDA-2.4 — DB-seeded owner analytics browser proof
  - PDA-2.5 — Owner value messaging + conversion surface
- Goal:
  - Use owner attribution context to show profile strength, missing profile items, and the next safe completion action without inflated claims.
- Validation:
  - `npm run test -- owner-profile-completion` ✅
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅
- Proof:
  - Owner dashboard renders profile strength score.
  - Missing schema-backed profile items are flagged.
  - Completed fields are not flagged.
  - "Why this matters" guidance renders for missing items.
  - "Update next missing item" CTA renders.
  - Completed-state copy renders safely.
  - Authenticated browser proof covers completion-loop rendering.

13. PDA-2.7 Owner Action Tracking Loop
- Status: PASS
- Commit: `3ab69692`
- Depends on:
  - PDA-2.6 — Owner profile completion loop
- Goal:
  - Track owner clicks on profile-completion guidance CTA with owner/entity scope and missing item context.
- Validation:
  - `npm run test -- owner-profile-completion-action` ✅
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅

14. PDA-2.8 Owner Completion Action Analytics Surface
- Status: PASS
- Commit: `6da18f8b`
- Depends on:
  - PDA-2.7 — Owner action tracking loop
- Goal:
  - Expose owner-scoped 7d/30d profile completion action counts grouped by missing item key and entity scope, then render a dashboard surface for measured completion actions.
- Validation:
  - `npm run test -- owner-profile-completion-actions` ✅
  - `npm run test -- owner-value-attribution-ui` ✅
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅

15. PDA-2.9 Owner Profile Completion Outcome Reconciliation
- Status: PASS
- Commit: `048b6e3b`
- Depends on:
  - PDA-2.8 — Owner completion action analytics surface
- Goal:
  - Reconcile profile-completion CTA clicks against current completion status to report clicked, now complete, and still missing counts by missing item key.
- Validation:
  - `npm run test -- owner-profile-completion-reconciliation` ✅
  - `npm run test -- owner-profile-completion-actions` ✅
  - `npm run test -- owner-value-attribution-ui` ✅
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅

## What is now live

- Public SEO/discovery pages route into canonical `/p/...` profiles.
- Discovery page views, card/profile clicks, and CTA clicks are tracked.
- Admin aggregate view shows top discovery pages, top profiles, and top cities.
- Owner/admin analytics loop is closed from discovery traffic to profile actions.

## Remaining non-blocking gaps

1. SEO ranking/dedupe tuning.
2. Richer structured data (`schema.org`) coverage.

## Current source-of-truth KPI

Know which public discovery pages create profile traffic and customer action.

16. PDA-2.10 Shared Profile Completion Status Adapter
- Status: PASS
- Commit: `d51b8abb`
- Depends on:
  - PDA-2.9 — Owner profile completion outcome reconciliation
- Goal:
  - Eliminate completion-state drift by using one shared adapter to compute missing/completed status across owner completion UI and reconciliation logic.
- Validation:
  - `npm run test -- owner-profile-completion-status` ✅
  - `npm run test -- owner-profile-completion-reconciliation` ✅
  - `npm run test -- owner-profile-completion-actions` ✅
  - `npm run test -- owner-value-attribution-ui` ✅
  - `npm run test -- owner-value-attribution-browser` ✅
  - `npm run test:run` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npm run verify:routes` ✅
- Proof:
  - Shared `profileCompletionStatus` adapter is used by reconciliation and owner dashboard completion logic.
  - Deterministic contract verifies reconciliation follows shared adapter output.

17. PDA-2.11 Deterministic Completion Reconciliation Runtime Test
- Status: PASS
- Commit: `2dcc7061`
- Depends on:
  - PDA-2.10 — Shared profile completion status adapter
- Goal:
  - Prove seeded runtime reconciliation math for `clicked`, `nowComplete`, and `stillMissing` using the shared completion-status adapter.

18. PDA-2.12 Targeted Test Runner Exact-Match Safety
- Status: PASS
- Commit: `94b90822`
- Depends on:
  - PDA-2.11 — Deterministic completion reconciliation runtime test
- Goal:
  - Ensure targeted test execution matches intended scripts exactly and does not pull in prefix-sharing scripts unintentionally.

19. P0 Role-Aware Onboarding + Role Correction
- Status: PASS — code-side
- Commit: `c02173c3`
- Goal:
  - Allow safe role correction during onboarding, preserve setup draft data, and provide a codebase audit entrypoint for onboarding-role integrity.
- Validation:
  - `node scripts/role-onboarding-role-correction.contract.test.ts` ✅
  - `npm run check` ✅
  - `npm run build` ✅
  - `npx tsx scripts/role-onboarding-integrity-audit.ts` N/A locally (`DATABASE_URL` not set)

20. P0 Scout Discoverability Menu Gate
- Status: PASS
- Commit: `650e9f8d`
- Goal:
  - Require at least one canonical menu item for customer-facing Scout discovery while keeping admin/owner/direct-profile visibility intact.
- Implemented:
  - Customer-facing Scout discovery requires `menuItemCount > 0`
  - Live truck discovery requires at least one canonical menu item
  - Direct public profile routes remain resolvable
  - Admin/owner surfaces are not gated
  - Linked zero-menu businesses route to menu setup
- Validation:
  - `node scripts/scout-discoverability-menu-gate.contract.test.ts` ✅
  - `npm run check` ✅
  - `npm run build` ✅

Issue #17 closure note
- Closed for:
  - role correction
  - menu-gated Scout discoverability

21. P0 Batch Intake Smoke Auth Preflight (CSRF-safe local runner)
- Status: PASS
- Commit: `2999df72`
- Goal:
  - Ensure local admin smoke runs can authenticate through CSRF origin guard without weakening runtime protections.
- Implemented:
  - Added `Origin` and `Referer` headers in `scripts/bulkProfileEvidenceIngest.ts` login/apply requests.
  - Preserved preview-mode safety boundaries (no publish/trash mutations).
- Validation:
  - Authenticated preview smoke completed with report output.
  - `npm run check` ✅
  - `npm run build` ✅

22. P0 Onboarding Promotion + Menu Discovery Contracts
- Status: PASS
- Commit: `259204b4`
- Goal:
  - Promote business onboarding/setup data into canonical profile records, attach owner linkage, preserve menu promotion behavior, and enforce continuation/discovery contract coverage.
- Implemented:
  - Added shared onboarding promotion service: `promoteBusinessSetupToProfile(...)`.
  - Wired promotion into signup flow and admin create+attach repair action.
  - Added continuation/readiness fields in auth hook consumption.
  - Added admin food-truck inventory endpoint for profile completeness operations.
  - Hardened public truck entity handling in discovery/profile resolution paths.
  - Added contract coverage for signup menu attachment, login continuation, and public truck discovery menu behavior.
- Validation:
  - `node scripts/business-signup-menu-attachment.contract.test.ts` ✅
  - `node scripts/login-continuation.contract.test.ts` ✅
  - `node scripts/public-food-truck-discovery-menu.contract.test.ts` ✅
  - `npm run check` ✅
  - `npm run build` ✅

