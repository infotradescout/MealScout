# MealScout Passive User Quality Signals Existing-State Audit

Date: 2026-06-16
Baseline: `13dab6f35bad947f33a11bb171b4e2e8e8e24d6f`
Lane: Existing-State Audit - Passive User Quality Signals
Mode: Docs-only audit

## Scope

This audit inspects existing MealScout plumbing for passive bug detection, user-quality signals, analytics, logs, error handling, missing-content detection, and admin/operator visibility.

This audit does not design or implement a new passive bug system. It records what already exists, what is partial or unused, and what is missing.

## Files Inspected

- `client/src/main.tsx`
- `client/src/App.tsx`
- `client/src/components/navigation.tsx`
- `client/src/components/bug-report-button.tsx`
- `client/src/components/maps/map-error-boundary.tsx`
- `client/src/components/smart-search.tsx`
- `client/src/pages/public-profile.tsx`
- `client/src/pages/public-seo-landing.tsx`
- `client/src/pages/search.tsx`
- `client/src/pages/scout-prototype.tsx`
- `client/src/pages/AdminControlCenter.tsx`
- `client/src/pages/AdminSupportTickets.tsx`
- `client/src/pages/admin-telemetry.tsx`
- `client/src/pages/profile/help.tsx`
- `client/src/utils/uxTelemetry.ts`
- `server/index.ts`
- `server/adminRoutes.ts`
- `server/incidentRoutes.ts`
- `server/routes/analyticsRoutes.ts`
- `server/routes/geoAdRoutes.ts`
- `server/routes/publicDiscoveryRoutes.ts`
- `server/routes/scoutSurfaceRoutes.ts`
- `server/routes/supportRoutes.ts`
- `server/routes/admin/adminCoreOpsRoutes.ts`
- `server/routes/restaurantOperationsRoutes.ts`
- `server/services/scoutSurfaceService.ts`
- `server/telemetryRoutes.ts`
- `shared/schema/legacy.ts`
- `scripts/public-profile-menu-logo-schedule.contract.test.ts`
- `scripts/public-discovery-analytics.contract.test.ts`
- `scripts/scout-discoverability-menu-gate.contract.test.ts`
- `scripts/owner-discoverability-menu-state.contract.test.ts`
- `docs/EMAIL_TRIGGER_INVENTORY.md`
- `docs/MEALSCOUT_LAUNCH_SURFACE_AUDIT.md`
- `docs/REPO_LANES.md`
- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`

## 1. Current Existing Signals

MealScout already has several operational signal paths.

### Server Request Logs

`server/index.ts` writes non-static requests into `request_logs` after each response. The stored fields include method, path, status code, duration, user ID, session ID, anonymous actor ID, actor/source classification, event type, surface, entity ID/type, IP, user agent, metadata, and timestamp.

Confirmed behavior:

- Static assets are intentionally skipped.
- Actor classification distinguishes human, bot, and LLM crawler style traffic from user agent signatures.
- Route-derived event typing exists for search, profile views, category views, saves, calls, website clicks, directions, and conversion intent.
- Retention is described in schema comments as request logs for admin reporting with 48-hour retention, while daily summaries are stored separately.

Limit:

- The generic route-derived profile extraction in `server/index.ts` only recognizes `/restaurant/:id` as a restaurant profile. Clean `/truck/{slug}--{uuid}` public profile routes are still stored as page requests, but the generic request logger does not extract their truck entity ID/type there.

### Public Profile Analytics

`client/src/pages/public-profile.tsx` posts to `/api/public/profile-analytics` for:

- `profile_view`
- `menu_click`
- `directions_click`
- `call_click`
- `website_click`
- `order_click`
- `delivery_click`
- `deal_click`
- `event_click`
- `social_click`
- `share_click`
- QR opens
- catering and truck-booking clicks

`server/routes/publicDiscoveryRoutes.ts` validates the action type, filters owner/admin preview traffic, verifies the profile exists, and records accepted events into `request_logs` with `surface = "public_profile"`.

This is a strong existing path for passive profile interaction telemetry.

### Public Discovery Analytics

`client/src/pages/public-seo-landing.tsx` posts discovery events to `/api/public/discovery-analytics`.

Supported discovery events:

- `discovery_page_view`
- `discovery_card_click`
- `discovery_profile_click`
- `discovery_cta_click`

`server/routes/publicDiscoveryRoutes.ts` records these in `request_logs` with `surface = "public_discovery"` and exposes `/api/admin/discovery-analytics`.

Confirmed admin aggregation includes:

- discovery page views
- card clicks
- profile clicks
- CTA clicks
- top discovery pages
- top clicked profiles
- top cities

### Search Query Tracking

`client/src/pages/search.tsx` calls `/api/search/track` on submitted search terms. `server/routes/analyticsRoutes.ts` normalizes and drops risky or low-quality inputs, then stores accepted terms in `search_query_events`.

Existing search visibility includes:

- `/api/search/trending`
- `/api/search/latest`
- source tagging such as `search_submit`
- privacy filtering for emails, URLs, and long digit strings

### UX Recovery Telemetry

`client/src/utils/uxTelemetry.ts` posts anonymous/minimal UX events to `/api/telemetry/track`, backed by `telemetry_events` through `server/routes/geoAdRoutes.ts`.

Search already records recovery-style events such as:

- `search_did_you_mean_clicked`
- `search_location_request_empty`
- `search_featured_empty`
- `search_open_map_empty`
- `search_location_request_inline`
- `search_open_map_inline`

`server/telemetryRoutes.ts` exposes `/api/admin/telemetry/ux-recovery`, and `client/src/pages/admin-telemetry.tsx` renders a read-only telemetry viewer.

### Manual Bug Reports

There are two user-initiated bug-report paths:

- `client/src/components/navigation.tsx` includes a `Report Bug` action that captures a screenshot with `html2canvas`, current URL, and user agent, then posts to `/api/bug-report`.
- `client/src/components/bug-report-button.tsx` is a separate floating bug report button with similar behavior.

`server/routes/analyticsRoutes.ts` receives `/api/bug-report` and uses `emailService.sendBugReport`. `docs/EMAIL_TRIGGER_INVENTORY.md` records the bug report email trigger.

This is useful but not passive. It depends on the user recognizing the bug and submitting it.

### Support Tickets

`client/src/pages/profile/help.tsx` lets authenticated users open support tickets, including category `bug`.

`server/routes/supportRoutes.ts` stores tickets in `support_tickets` and notifies super admin. `client/src/pages/AdminSupportTickets.tsx` and `server/adminRoutes.ts` provide admin visibility and status updates.

Again, this is user-reported rather than passive.

### Server Error Handling

`server/index.ts` initializes Sentry when configured, captures Express middleware errors with `Sentry.captureException`, and logs fatal uncaught exceptions/unhandled rejections before shutdown.

This is server-side only. It does not currently prove browser page crashes or React render crashes are captured.

### Frontend Runtime Recovery

`client/src/main.tsx` has production-only chunk/module recovery for dynamic import failures. It can unregister service workers, clear runtime caches, and reload with a cache-busting query parameter for chunk-loading and MIME-type failures.

This protects against stale asset deploy issues, but it is not general page crash reporting.

### Map Error Boundary

`client/src/components/maps/map-error-boundary.tsx` exists and is used around map surfaces such as `client/src/pages/map.tsx` and `client/src/pages/explore-preview.tsx`.

This catches map-specific render failures and shows a fallback. It does not cover `PublicProfilePage`, Scout, search, or the whole app.

### Missing Menu/Schedule/Logo Empty States

`client/src/pages/public-profile.tsx` contains honest incomplete-state rendering:

- hero image falls back to initials artwork when image/logo data is missing
- truck schedules show status text or `Schedule: none found.`
- menu states include `Menu unavailable right now.` and `Menu: none found.`
- missing map coordinates show `Map coordinates are not available yet.`
- no host trucks show `No trucks listed right now. Check back soon.`
- absent deals do not render a broken section

`scripts/public-profile-menu-logo-schedule.contract.test.ts` protects these states.

### Scout Surface Content Signals

`server/services/scoutSurfaceService.ts` emits Scout card status labels such as `Open now`, `Closed now`, and `No schedule`, and reasons such as `Schedule not published yet`.

The recent route consistency lane also protects clean truck CTA routes. Current live Scout truck card links use `/truck/{slug}--{uuid}` for `entityType === "truck"` cards.

### Profile Completion / Evidence Docs

Several evidence and contract files already track profile completeness and missing content, especially for live Scout trucks:

- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json`
- live truck evidence batch files
- Blessed Berry schedule evidence/apply artifacts
- owner discoverability/menu-state contracts
- Scout discoverability menu gate contracts

These are useful QA artifacts, but they are mostly static/process evidence rather than live passive user-signal feeds.

## 2. Partial or Unused Signals

### Duplicate Bug Report UI

There is both a reusable `BugReportButton` and a navigation-level `Report Bug` implementation. The navigation implementation appears active through `client/src/components/navigation.tsx`; the standalone floating component exists but may not be mounted everywhere.

### Server Sentry Without Frontend Crash Capture

Server Sentry exists, but there is no inspected client-side Sentry setup, no global React error boundary for the app, and no route/page crash event endpoint for browser render failures.

### Chunk Recovery Without Reporting

`client/src/main.tsx` can recover stale chunks, but it silently reloads. It does not send a passive quality event like `chunk_recovery_attempted` or `chunk_recovery_failed`.

### Request Logs Are Broad, Not Quality-Specific

`request_logs` can reveal 404s, 500s, slow routes, repeated requests, and crawler/human traffic. However, it does not classify user-facing quality problems such as:

- blank page after successful HTML load
- image failed after page loaded
- profile rendered but missing menu
- schedule stale
- Scout CTA was clicked and then resolved to not-found

### Public Profile Analytics Tracks Actions, Not Content Gaps

Profile views and CTA clicks are tracked, but passive missing-content views are not recorded as specific events. A profile view on a page with no menu/schedule/logo is indistinguishable from a profile view on a complete page unless an operator cross-joins profile content state separately.

### Discovery Analytics Is Mostly Public SEO Landing Oriented

Discovery analytics is implemented for public SEO landing pages and is visible in the admin control center. The `/scout` page itself is still `client/src/pages/scout-prototype.tsx`, and this audit did not find direct `/api/public/discovery-analytics` event posting from that page.

### Scout Has Multiple Surfaces

There are several Scout-related paths:

- `/scout` renders `client/src/pages/scout-prototype.tsx`
- `/scout-prototype` also renders the same component
- newer component and adapter files exist under `client/src/components/scout/` and `client/src/features/scout/`
- `/api/scout/surface` exists server-side

This suggests Scout has both current and emerging implementations. Passive quality work should avoid broad Scout redesign and target only the active `/scout` route unless a later lane deliberately consolidates surfaces.

### Search Tracks Queries, Not No-Result Outcomes

Search submitted terms are stored, and empty-state button recovery actions are tracked. But the actual event `search returned zero results` is not explicitly stored with result count, city, radius, or selected filters.

### Support Tickets and Bug Reports Are Not Unified

Manual bug reports send email, while support tickets are database-backed and admin-visible. They do not appear to feed a single passive issue queue.

### Admin Views Exist, But Not a Quality Queue

Operators can inspect request logs, bot traffic, daily reports, discovery analytics, support tickets, telemetry, and business/admin metrics. There is no inspected dashboard that says: "These profiles are user-viewed and missing menu/schedule/logo" or "These Scout links are clicked and failing."

## 3. Invisible User Problems

These problems are currently not automatically visible as first-class passive quality signals:

- Browser page crashes outside map boundaries, including React hook-order crashes.
- Blank screen after successful HTML/JS load.
- Console errors on public profiles that do not crash the page.
- Failed image/logo/cover loads in public profile or Scout cards.
- Public profile `Profile not found` renders as a client state rather than being captured as a profile 404 quality event.
- Scout card click that leads to 404 or blank page.
- Search with zero results, including query, city, filters, and radius.
- Repeated city/location search for low-coverage places.
- Profile views where menu is missing.
- Profile views where schedule is missing.
- Profile views where schedule is stale.
- Profile views where logo/hero image is missing or broken.
- Users leaving immediately after seeing a missing-content profile.
- Incomplete profiles with high public demand.
- Public pages repeatedly recovering from stale chunks.

## 4. Natural User Signals

Normal user behavior already creates useful signals, but the signals are not always captured in quality-specific form.

Existing natural signals:

- Opening a public profile records `profile_view` through `/api/public/profile-analytics`.
- Tapping profile CTAs records `profile_action` with action type and href category.
- Submitting search records the query in `search_query_events`.
- Tapping search empty-state recovery buttons records UX telemetry.
- Opening public SEO discovery pages and clicking cards records discovery analytics.
- Every non-static server request records status code, path, duration, user agent, actor type, and referrer.
- Manual support tickets and bug reports capture explicit user-reported failures.

Natural signals not yet captured directly:

- Tapping a bad Scout card and landing on a not-found profile.
- Seeing `Menu: none found.` or `Schedule: none found.` after a profile view.
- Seeing a stale schedule.
- Failed image/logo load on the client.
- Blank page or React render crash.
- Returning quickly from a broken/missing-content page.
- Searching a city with low/zero coverage.

## 5. Existing Admin/Operator Visibility

Operators already have several places to see related data:

- `/admin/telemetry` via `client/src/pages/admin-telemetry.tsx` for traction, UX recovery, premium ops, heartbeat, and related telemetry.
- `AdminControlCenter` uses `/api/admin/discovery-analytics` and `/api/admin/bot-traffic`.
- `/api/admin/request-logs` exposes raw recent request logs.
- `/api/admin/daily-reports` exposes stored daily request summaries.
- `/api/admin/support-tickets` plus `client/src/pages/AdminSupportTickets.tsx` show user-created support tickets.
- `/api/admin/telemetry/heartbeat` includes marketplace counts like food trucks, active deals, events, and trucks currently online.
- Owner/business analytics paths use `request_logs` to report public profile views and actions for owners.

Visibility gap:

There is no inspected operator page that combines passive user demand with content quality gaps. Thomas can see logs/telemetry/support, but he cannot yet see a prioritized list like "high-view truck profiles missing schedules" or "Scout card clicks that ended in 404/blank."

## 6. Privacy-Safe First Signal List

The smallest privacy-safe passive signals should be operational and minimal. They should avoid screen recording, private content capture, keystroke logging, or selling user data.

Recommended first candidates:

- `public_profile_page_error`: client-side page error or React boundary failure, with route, profile type/id if known, app version, and sanitized message category.
- `public_profile_not_found_viewed`: user saw the public profile not-found state, with route and extracted entity ID if present.
- `scout_card_navigation_failed`: user clicked a Scout card and landed on a 404/not-found profile or failed route.
- `missing_menu_viewed`: public profile rendered with no menu or menu unavailable.
- `missing_schedule_viewed`: public truck profile rendered no schedule.
- `stale_schedule_shown`: public truck profile rendered a schedule older than an agreed freshness threshold.
- `failed_profile_image`: public profile hero/logo image failed to load.
- `failed_scout_card_image`: Scout card image failed to load.
- `search_no_results`: submitted search produced zero structured matches, with query normalized/sanitized, city/radius/filter metadata if available.
- `city_low_coverage_search`: repeated city/location searches with few or zero local food results.

Data minimization rules:

- Do not store screenshots for passive events.
- Do not store raw free-form user text except already-filtered search query events.
- Hash or omit IP/session identifiers unless needed for rate-limiting/deduplication.
- Store route path, entity ID/type, event type, counts/state flags, app build SHA, and timestamp.
- Keep the event payload operational, not behavioral profiling.

## 7. Smallest Safe Implementation Lane

Recommended first implementation lane:

```text
MealScout passive public-profile quality signals - page error and missing-content views
```

Tier:

```text
T2 runtime non-mutating
```

Why this lane first:

- It directly follows the live public truck profile crash incident.
- Public profiles already have `profile_view` and `profile_action` analytics, so the new work can extend an existing operational pattern instead of adding a new analytics platform.
- It can be limited to public profiles before touching Scout redesign, B2, import tooling, admin workflows, or schema-heavy systems.
- It helps users immediately by making blank pages and high-demand missing-content pages visible to operators.

Suggested narrow scope:

- Add a public-profile-safe error boundary around `PublicProfilePage` or app public-profile route rendering.
- Emit a privacy-safe event when the boundary catches a profile render error.
- Emit missing-menu and missing-schedule viewed events from existing public-profile render states.
- Reuse existing `request_logs` if feasible, or use `telemetry_events` only if schema friction is lower.
- Add a small admin/read model only if an existing admin surface can display it without broad redesign.

Suggested validation:

- Typecheck.
- Public profile route/assets contract.
- Public profile menu/logo/schedule contract.
- A focused contract proving no screenshots/session replay/private content are captured.
- Browser smoke for one complete and one incomplete public truck profile.

## 8. Explicit Non-Recommendations

Do not do these in the first implementation lane:

- No session replay.
- No screen recording.
- No passive screenshots.
- No broad analytics platform migration.
- No schema-heavy redesign unless a Gemini/Gawain gate explicitly selects it.
- No AI scoring or auto-prioritization.
- No Scout redesign in this lane.
- No B2/internal action-card work unless it directly feeds the eventual issue queue.
- No import tooling.
- No truck profile data mutation.
- No admin/claiming/map/live-feed changes.
- No selling or exporting user data.
- No collection of private user content.

## Summary Finding

MealScout already has useful hidden plumbing: request logs, public profile analytics, public discovery analytics, search query tracking, UX telemetry, manual bug reports, support tickets, admin telemetry, and missing-content UI contracts.

The gap is not "no analytics." The gap is that user-facing quality failures are not yet turned into a small operator-readable issue list. The next safest move is to connect existing public profile signals to a privacy-safe quality event path, starting with page errors and missing-content views.
