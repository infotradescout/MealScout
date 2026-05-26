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
- Commit: `pending`
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
