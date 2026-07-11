# MealScout Master Plan

## Purpose

Single source of truth for roadmap, operations, deployment, testing, deferred features, and unfinished ideas.

## North Star

- Keep the platform production-stable and fast on mobile.
- Make discovery, map, parking pass, events, and account flows consistent.
- Enforce trust, verification, and role-based actions.
- Grow monetization without pay-to-play ranking.

## Current Reality (as of July 2026)

- Core app is live with auth, map, parking pass, events, deals, admin, and Stripe support.
- **Online Ordering** has been launched and gated behind a $25/mo premium subscription per restaurant.
- **LISA (Location Intelligence & Supply Analytics)** is actively processing market intel, supply prices, and operating briefs.
- **Backend Refactoring**: Phase 2 (route composition), Phase 3 (storage split), and Phase 5 (oversized route decomposition) are merged and verified — see `docs/refactor/REFACTOR_BOARD.md` (nothing queued or in progress as of this writing). Phase 4 (schema modularization) has not started.
- **Mobile Responsiveness** has been completed across 30+ pages with a mobile-first design strategy (320px baseline).
- **Map & Geocode Integrity** is complete, achieving 100% coordinate coverage for primary hosts and secondary addresses.
- **Site-drift sweep (2026-07-05)**: consolidated duplicated public route definitions in `App.tsx`, unified business signup entry points onto the canonical `/restaurant-signup?businessType=...` flow, and fixed several route-level bugs (`/search` featured deals query, `/dashboard` blank fallback, `/share-hub` double auth fetch). See `docs/refactor/REFACTOR_BOARD.md` "Verified" section for the full list.

## Execution Plan

### Phase 1: Ordering & Premium Hardening (Now)

1. **Ordering Access Control**
   - Ensure the `$25/mo` subscription gate remains robust across all ordering and menu management routes.
   - Monitor the `ordering_subscription_denied` telemetry events to track conversion opportunities.
   - Maintain the automated ordering smoke auth and restaurant discovery tests.

2. **Premium Conversion Funnel**
   - Optimize the premium weekly summary cards, emails, and KPI tracking.
   - Refine the sales cheat sheet and operator-first value messaging.
   - Monitor share-to-conversion funnel metrics for delegated business permissions.

### Phase 2: Backend Refactor Continuation (Now)

1. **Storage Split (`docs/refactor/REFACTOR_BOARD.md` phase-3-storage-split)** — merged. Domain-specific query logic lives in repository-style modules (e.g., `usersRepository`, `paymentsSubscriptionsRepository`) behind a stable `IStorage`.

2. **Route Decomposition (REFACTOR_BOARD phase-5-oversized-route-splits)** — merged. `adminManagementRoutes`, `supplierMarketplaceRoutes`, and `hostRoutes` have been broken into focused sub-modules (e.g., `server/routes/suppliers/*`, `server/routes/admin/*`, `server/routes/hosts/*`).

3. **Schema Modularization** — the domain-file structure exists (`shared/schema.ts` re-exports `./schema/{core,users,restaurants,deals,hosts,events,parkingPass,admin,suppliers,ordering,hiring,marketIntel,growth,misc,moderation,scoutcoin}`), but `shared/schema/legacy.ts` still holds a large share of the actual table definitions pending further migration into the domain files. Not fully complete.

4. **Next backend refactor lane**: nothing is queued on `docs/refactor/REFACTOR_BOARD.md` as of this writing — pick the next target from oversized files before starting new phases.

### Phase 3: LISA & Market Intel Expansion (Near Term)

1. **LISA Operating Briefs**
   - Expand daily LISA operating briefs and direct actions.
   - Improve the translation of LISA livestream rows into actionable decisions for operators.
   - Track LISA brief actions across admin surfaces (snooze, done states).

2. **Supply Market Intel**
   - Harden Price Scout feed access and expand export surfaces.
   - Monitor automated supply market lanes and localized supply price watch data.

### Phase 4: Events and Open Calls (Near Term)

1. **Complete Event Open Calls Productization**
   - Finalize `event_series` model decisions.
   - Publish/occurrence generation and per-occurrence overrides.
   - Keep capacity guard semantics per occurrence.

2. **Series Operations**
   - Ensure full cancellation and truck notification behavior remain reliable.
   - Add operator metrics for series fill rate, acceptance throughput, cancellation impact.

### Phase 5: Growth Surfaces (Near-Mid Term)

1. **SEO and Location Growth**
   - Execute SEO expansion tasks from current canonical strategy (IndexNow, LLM SEO endpoints).
   - Improve empty-market bootstrap flows where useful.
   - Monitor the Pensacola report lead magnet and food truck drip campaigns.

2. **Social & Share Hub**
   - Monitor the social queue processor automation and share hub telemetry.
   - Ensure engagement actions remain hardened with throttling and idempotent writes.

### Phase 6: Mobile App Track (Mid Term)

1. **Wrapper Strategy**
   - Use Capacitor fast-track unless full migration is justified.

2. **Mobile Readiness**
   - Validate auth/session behavior, deep links, geolocation permissions, push support.

3. **Store Readiness**
   - Complete listing assets, privacy forms, testflight/internal testing, submission.

## Deferred Feature Registry (Explicit)

Keep but inactive unless approved for activation:

- Affiliate attribution/payout stack (`server/affiliateService.ts`, `server/affiliateRoutes.ts`, `shared/affiliateCopy.ts`)
- Empty-county content bootstrapping services (`server/emptyCountyService.ts`, `server/emptyCountyPhase6Service.ts`)
- Facebook/Replit auth stubs (`server/facebookAuth.ts`, `server/replitAuth.ts`)
- Featured video cron (`server/featuredVideoCron.ts`)

## Acceptance Gates

- **Release gate:** no auth/session regressions, no map pin regressions, no payment regressions.
- **Data gate:** admin counts match canonical queries.
- **UX gate:** no legacy style pages on core flows.
- **Ops gate:** rollback confirmed before release.

## Operating Cadence

- **Daily:** production errors, auth health, map/geocode failures, payment failures, LISA signal anomalies.
- **Weekly:** conversion funnel, upload volume, booking throughput, role growth, premium subscription conversions.
- **Monthly:** pricing outcomes, deferred-feature decisions, roadmap reprioritization.

## Immediate Next Actions

- [In Progress] Complete Phase 3 of the backend refactor (extracting remaining storage domains).
- [In Progress] Monitor the newly launched online ordering subscription gate and resolve any edge cases.
- [In Progress] Refine LISA market intel feeds and operator briefs based on initial usage data.
- [In Progress] Continue modularizing oversized route files (`adminManagementRoutes`, etc.).

## Execution Log

- **April 2026:** Gated online ordering features behind a $25/mo subscription. Automated ordering smoke auth and restaurant discovery. Enforced ordering subscription per restaurant.
- **April 2026:** Aligned deal and parking action panels with team permissions. Gated business nav and dashboard tabs by team permissions. Hardened delegated business permissions across owner-gated routes.
- **April 2026:** Extracted `analyticsRepository` and `parkingPassRepository` (Phase 3 backend refactor).
- **April 2026:** Extracted `host/event` and `restaurant/deal` persistence into repositories. Extracted user persistence methods into `usersRepository` module.
- **April 2026:** Extended auth token repository with API key persistence. Extracted auth token storage methods into repository module.
- **April 2026:** Refactored startup recurring jobs into bootstrap module and logged plan progress.
- **April 2026:** Added business employee invite links with selectable feature permissions.
- **April 2026:** Rewrote subscription flow copy for clearer user-facing messaging.
- **April 2026:** Replaced internal SEO phrasing with user-facing popular-nearby language. Tracked favorite, follow, recommend engagement telemetry events.
- **April 2026:** Added social queue processor automation and share hub telemetry. Hardened engagement actions with throttling and idempotent writes.
- **April 2026:** Added dedicated share hub nav and queued deal auto-share posts.
- **April 2026:** Boosted crawlability with prerender routes, IndexNow, and LLM SEO endpoints.
- **April 2026:** Added premium conversion funnel, target recommendation, ops telemetry to admin dashboard, weekly summary card, email, and KPI tracking.
- **April 2026:** Reframed premium around operator-first value. Simplified sales cheat sheet language. Refined restaurant mission and mobile ordering messaging.
- **April 2026:** Applied premium access gating and parking pass fallback fixes.
- **April 2026:** Added Spanish-ready client locale support.
- **April 2026:** Completed booking follow-through with parking-pass-only paid checkout. Event booking & payment system with no-refund policy.
- **April 2026:** Added foot-traffic cells with Google-enriched map overlays. Added density-aware traffic scoring and adaptive windows.
- **April 2026:** Added filterable observed-events API for row-level LISA truth inspection. Added canonical request event spine and consumed explicit actor/session fields in LISA intel.
- **April 2026:** Separated human truth scoring from machine support and added observed-event contract feed. Hardened auth and enforced truth-first LISA contract across MealScout.
- **April 2026:** Implemented monetization tiers and client API key management for Price Scout Feed. Hardened Price Scout feed access and expanded export surfaces.
- **April 2026:** Added automated supply market lanes and LISA lane exports. Added localized supply price watch market intel and food trend data.
- **April 2026:** Added daily LISA operating briefs, grouped repeated LISA livestream patterns, and translated LISA livestream rows into decisions.
- **March 2026:** Phase 3 Map & Geocode Integrity Complete. Audited all host and secondary address geocoding. Achieved 100% coordinate coverage.
- **March 2026:** Mobile Responsiveness Cleanup Complete. Applied responsive padding pattern (px-4 sm:px-6) across 30+ pages.
- **March 2026:** Completed backend refactor Phase 1 startup extraction for recurring background jobs.
