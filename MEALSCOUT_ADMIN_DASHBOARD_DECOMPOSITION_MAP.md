# MealScout Admin Dashboard Decomposition Map

This map is for cleanup/stabilization only. It documents how to understand and eventually decompose `client/src/pages/admin-dashboard.tsx` without changing runtime behavior.

## Current File

`client/src/pages/admin-dashboard.tsx`

Why it is dangerous:

- It is a single overloaded admin operations surface that mixes read models, mutations, dialogs, tab routing, cache invalidation, and visual rendering.
- It owns sensitive production controls: Launch Board outcomes, claim pitches, truck imports, profile evidence application, insurance verification, user role changes, staff promotion, host/parking-pass repair, payout review, and admin messaging.
- It calls many privileged `/api/admin/*` endpoints directly from component code, so casual edits can change production data, expose staff/admin surfaces, or bypass intended auth/role constraints.
- It mixes Parking Pass admin repair controls with user profile editing; insurance verification changes can affect Parking Pass booking eligibility.
- It includes LISA/admin panels, moderation links, geo/market tools, profile/import workflows, and admin user controls in one file, so unrelated cleanup can accidentally alter operational semantics.

Why it should not be refactored casually:

- Do not extract regions until the exact endpoint names, mutation payloads, React Query keys, cache invalidations, tab values, status values, and role gates are preserved.
- Do not combine decomposition with visual redesign, new product features, API rewrites, or permission changes.
- Do not use live production mutation smokes unless fixtures, staging, or explicit production-test-record approval exist.

Validations that must run after touching it:

- `node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`
- `node scripts/mealscout-one-market-launch-board.contract.test.ts`
- `node scripts/mealscout-claim-pitch-flow.contract.test.ts`
- `node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts`
- `node scripts/admin-insurance-verification.contract.test.ts`
- `npm run gate:production`
- `npm run check`
- `npm run build`

## Current Major Regions

Map by functional region before line-by-line refactor work:

- **Admin auth / admin user state**: verifies `/api/auth/admin/verify`, computes staff/admin/duper/super-admin capability flags, handles logout, and controls privileged rendering.
- **Tab selection and high-level dashboard shell**: owns `selectedTab`, URL tab/focus-user behavior, header, dashboard switcher, stats overview, quick tools, `TabsList`, and tab routing.
- **Launch Board query/rendering**: loads `/api/admin/launch-board`, renders one-market launch metrics, leak fix queue, and posts `/api/admin/launch-board/leak-fixes/:fixId/outcome`.
- **Food truck inventory / unclaimed imports**: queries `/api/admin/food-trucks/inventory`, imports CSV/TSV/XLSX via `/api/admin/truck-imports`, reviews `/api/admin/truck-import-listings/unclaimed`, edits listings, purges batches, and invites imported trucks.
- **Claim pitch creation/status/share actions**: creates `/api/admin/claim-pitches`, updates `/api/admin/claim-pitches/:listingId/status`, copies/open claim URLs, and tracks `created`, `sent`, `opened`, `claim_started`, and `claim_completed` states.
- **Insurance verification controls**: verifies user insurance through `/api/admin/users/:userId/verify-insurance` and displays stored insurance status/expiry in admin user detail surfaces.
- **User management/admin controls**: lists `/api/admin/users`, creates users, changes role/type/status, resends/forces email verification, sends messages, attaches or creates business shells, edits user/profile/address/restaurant/deal/event/series/booking rows, and includes elevated danger-zone deletes.
- **Market/geo tools**: includes map-pin audit/retry, location demand funnel, host locations, geocoding, Parking Pass cache/backfill/normalization/integrity repair, and market/geo health cards.
- **Moderation/admin telemetry**: links moderation queue, loads profile quarantine suspects, duplicate emails, email status/attempts, user activity, telemetry counts, and profile evidence application.
- **Support/safety/admin panels**: includes staff management, admin messaging safeguards, host payout requests/export, Parking Pass onboarding/pricing/reminder repair, share portal, LISA market intelligence/signals/priorities/brief actions, and support-adjacent operational panels.

## Proposed Component Boundaries

Future decomposition should use explicit prop boundaries and preserve every endpoint, query key, tab value, and mutation payload.

- `AdminDashboardShell`: auth state, header, dashboard switcher, stats cards, tab list, selected tab state, and shared layout.
- `AdminOverviewTab`: dashboard totals, platform health, operations, map pin parity, admin quick tools, Parking Pass operational summaries, and LISA/moderation links.
- `AdminLaunchBoardTab`: Launch Board city filter, metric sections, leak fix queue, and leak fix outcome mutation.
- `AdminFoodTruckInventoryTab`: food truck inventory query/filtering, imported/unclaimed truck review, profile quarantine links, and truck profile remediation actions.
- `AdminClaimPitchPanel`: claim pitch creation, copy/open URL actions, sent/opened/start/completed status handling, and sent tracking UI.
- `AdminInsuranceVerificationControls`: insurance verified/expiry display and `/api/admin/users/:userId/verify-insurance` mutation controls.
- `AdminUserManagementTab`: user list filters, role/type/status controls, user detail dialog, business attachment, admin messaging, and elevated delete controls.
- `AdminMarketGeoTab`: map pin audit, geocode retry, host locations, location demand funnel, Parking Pass repair/cache/integrity controls, and market/geo health tooling.
- `AdminModerationTab`: quarantine suspects, profile evidence apply panel, moderation links, duplicate email review, and content/profile safety surfaces.
- `AdminTelemetryTab`: email status/attempts, user activity, event counts, LISA market intelligence/signals/priorities/brief actions, and operational telemetry panels.

## Extraction Order

Use this safe order. Do not jump directly to hooks/API clients before component boundaries prove stable.

1. Pure display cards: extract cards with no mutations and no cache invalidation first.
2. Launch Board metric grid: extract read-only metric rendering while preserving metric names and payload shape.
3. Claim pitch panel: extract existing create/share/status UI without changing claim pitch status values or endpoint paths.
4. Food truck inventory table/cards: extract inventory/import display and filters while preserving query keys and mutation payloads.
5. Insurance controls: extract display and verify button only after `admin-insurance-verification.contract.test.ts` is green.
6. User management: extract filters, user list, and user detail dialog in small pieces, preserving role gates and danger-zone behavior.
7. Geo/market tools: extract map pin, host location, location demand, Parking Pass repair, and payout panels after route/API contracts are stable.
8. Shared hooks/API clients: only extract query/mutation wrappers after the UI components are separated and existing contracts prove endpoint/query-key stability.

## Do-Not-Touch Rules

- Do not change endpoint paths.
- Do not change auth gates.
- Do not change Launch Board metric names.
- Do not change claim pitch status values.
- Do not change insurance verification semantics.
- Do not change Parking Pass booking eligibility.
- Do not change mutation behavior during decomposition.
- Do not introduce new features.
- Do not add new product feature scope, dashboards, monetization flows, or provider integrations during this cleanup slice.
- Do not run live admin insurance verification, booking, payment, payout, messaging, or delete mutations without fixtures, staging, or explicit approval.

## Required Validations

Run the full C4 validation set after any future touch to `client/src/pages/admin-dashboard.tsx`:

- `node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`
- `node scripts/mealscout-one-market-launch-board.contract.test.ts`
- `node scripts/mealscout-claim-pitch-flow.contract.test.ts`
- `node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts`
- `node scripts/admin-insurance-verification.contract.test.ts`
- `npm run gate:production`
- `npm run check`
- `npm run build`

If live probes are inappropriate in a local environment, use `SKIP_LIVE_PROBES=true npm run gate:production`; production deploys should run live probes enabled.

## Exit Criteria For Future Refactor

A future developer can extract one component only when:

- Contract tests remain green.
- No endpoint names changed.
- No metric names changed.
- No mutation behavior changed.
- Visual behavior is preserved.
- Component has a clear prop boundary.
- The extraction is one component or one narrow display cluster, not a behavior rewrite.
- The cleanup remains docs/contracts/decomposition work and does not introduce new product features.

## Protection Matrix

- Launch Board extraction is protected by `node scripts/mealscout-one-market-launch-board.contract.test.ts`, `npm run gate:production`, `npm run check`, and `npm run build`.
- Claim pitch extraction is protected by `node scripts/mealscout-claim-pitch-flow.contract.test.ts`, `node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts`, `npm run check`, and `npm run build`.
- Insurance verification extraction is protected by `node scripts/admin-insurance-verification.contract.test.ts`, `npm run gate:production`, `npm run check`, and `npm run build`.
- Route/admin boundary awareness is protected by `node scripts/mealscout-route-map.contract.test.ts` and the production gate.

## Handoff Summary

`client/src/pages/admin-dashboard.tsx` currently owns the admin dashboard shell, all major admin tabs, and several production-sensitive admin mutation paths. C4 does not refactor it. C4 makes the future refactor boring: extract read-only display first, preserve endpoint/query/status semantics, then split mutation-heavy panels only when contracts stay green.
