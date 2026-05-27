# MealScout Release Ledger

Last updated: 2026-05-26 (America/Chicago)

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
