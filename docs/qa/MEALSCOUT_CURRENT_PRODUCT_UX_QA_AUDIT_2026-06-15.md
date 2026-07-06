# MealScout Current Product UX QA Audit

Date: 2026-06-15
Repo: MealScout / mealscout.us
Branch: main
Baseline HEAD claim: `9e357ebf3514f9681b681c92f9fd0e089d34b0bd`
Gemini verdict carried in: PASS WITH AUDIT CONDITIONS
Audit posture: AUDIT / EVIDENCE ONLY

## Boundaries

This pass made no runtime code changes, no schema changes, no data mutations, no outreach sends, no owner-approved data mutations, no import runs, and no bug fixes. Claim emails remain on HOLD.

Blocked work during this lane:

- Runtime refactor
- Feature expansion
- Database schema edits
- Data mutation
- Public exposure changes
- Outreach or claim email sends
- Owner-approved menu/profile publication
- Committing this report without Thomas review

Known blocker handling:

- The attached packet names a pre-existing TypeScript blocker in `src/server.ts`: missing `getMealScoutAffiliateAttributionActionCards` from `src/mealscoutAffiliateAttributionKpiRollup.ts`.
- This audit did not treat that as a reason to stop. A repo search did not reproduce those exact paths/symbols in this MealScout tree; current server code is under `server/`.
- `npm run check` passed in this tree, so the named blocker did not appear during this audit validation.

## Target Routes

1. Homepage: `/`
2. Public Discovery/Profile: `/p/:entityType/:id`
3. Map Workspace: `/map`
4. Onboarding/Setup Panel: `/restaurant-owner-dashboard?setup=profile`
5. OCR Administrative Queue: `/admin/mealscout-review-queue`

Viewport assumptions: static source review for desktop and mobile-responsive risk, no browser interaction, no authenticated operator session, and no action buttons clicked. A browser pass is still required before release because several target surfaces can POST analytics, reports, or owner/admin actions when interacted with.

Review method:

- Static route inventory in `client/src/App.tsx`
- Static UI/copy review of target page components
- Static server/public profile contract review
- Safe GET attempted for one prior seeded truck profile API URL; it returned 404 and was not used as proof of UI state
- No JavaScript-executing public profile browser load, to avoid profile analytics mutation

## Files Inspected

- `README.md`
- `WORKFLOW.md`
- `client/src/App.tsx`
- `client/src/pages/welcome.tsx`
- `client/src/pages/map.tsx`
- `client/src/pages/public-profile.tsx`
- `client/src/pages/restaurant-owner-dashboard.tsx`
- `client/src/pages/admin/ModerationQueue.tsx`
- `server/routes/publicDiscoveryRoutes.ts`
- `server/publicProfiles/toPublicRestaurantProfile.ts`
- `server/publicProfiles/assertPublicResponseSafe.ts`
- `server/routes/truckClaimRoutes.ts`
- `server/moderationRoutes.ts`
- `server/moderationService.ts`
- `server/routes/admin/truckImportAdminRoutes.ts`
- Existing docs/process files under `docs/process/`

## Working Behavior

- `/`, `/map`, `/p/:profileType/:profileId`, and `/restaurant-owner-dashboard` are registered client routes.
- Public profile routes include both `/p/:profileType/:profileId` and `/p/:profileType/:profileId/:profileSlug`.
- Server public discovery supports resolving a truck import listing id to a canonical restaurant profile via `claimedFromImportId`.
- Public profile schedule UI separates closed truck rows under "Closed days"; closed rows are not presented as direction-enabled live stops in the inspected UI.
- Public profile has visible "Claim or update" and "Business owner?" entry points.
- Map workspace includes live truck, host, supplier, parking, empty-state, and map-service-unavailable states.
- Owner setup mode has a profile basics workspace, save control, QR kit area, completion signals, and setup-specific labels.
- The closest registered admin queue is `/admin/moderation/queue`, which has queue filters, case list, detail panel, evidence links, and moderation actions.

## Defects Found

### P1-1: Seeded Unverified Truck Profiles Do Not Show Public Unclaimed Status

Route: `/p/:entityType/:id`
Repro: Open a seeded/imported truck public profile that has `verifiedProfile: false`.
Expected: The page visibly explains that the profile is unverified or unclaimed, while still allowing the owner to claim/update it.
Actual: `HeroBlock` only renders a `Verified` badge when `profile.verifiedProfile` is true. There is no corresponding unverified/unclaimed badge or explanation when false. Server mapping exposes `verifiedProfile`, but no public claim-status display was found.
Impact: Public trust and brand risk. Users may interpret seeded candidate profiles as fully owner-confirmed MealScout truth.
Evidence: `client/src/pages/public-profile.tsx:299`, `server/publicProfiles/toPublicRestaurantProfile.ts:638`
Screenshot marker: `screenshot-public-profile-unverified-badge-missing`
Facing: Public user / owner
Category: Product trust risk

### P1-2: Requested OCR Administrative Queue Route Is Not Registered

Route: `/admin/mealscout-review-queue`
Repro: Search route registry for `/admin/mealscout-review-queue`.
Expected: A registered admin OCR/review queue route matching the requested target.
Actual: No exact route was found. The closest route is `/admin/moderation/queue`, which is a moderation queue, not an OCR administrative queue.
Impact: Operator QA cannot validate the requested OCR queue path; release instructions using that URL would misroute operators.
Evidence: `client/src/App.tsx:503`, `client/src/pages/admin/ModerationQueue.tsx:74`
Screenshot marker: `screenshot-admin-mealscout-review-queue-route-missing`
Facing: Admin/operator
Category: Operator/admin terminology and navigation risk

### P2-1: Homepage Hides Product Value Behind Auth-First CTAs

Route: `/`
Repro: Open homepage as a new user.
Expected: First viewport explains what MealScout does and offers a clear anonymous discovery path.
Actual: First visible controls are `Sign up`, `Log in`, and a secondary `Follow The Flavor` dialog trigger. The clearest description is inside the dialog, not on the page itself.
Impact: First-time users may think discovery requires an account.
Evidence: `client/src/pages/welcome.tsx:29`, `client/src/pages/welcome.tsx:55`
Screenshot marker: `screenshot-homepage-auth-first`
Facing: Public user
Category: User-visible copy issue

### P2-2: Homepage "Pick Your Path" CTA Is Ambiguous

Route: `/`
Repro: Open `Follow The Flavor` dialog.
Expected: CTA labels clearly separate diner discovery from owner/truck setup.
Actual: `Pick your path` links to `/customer-signup`, which sounds broader than the destination.
Impact: Owners or operators may choose the wrong path or lose confidence.
Evidence: `client/src/pages/welcome.tsx:83`
Screenshot marker: `screenshot-homepage-pick-your-path`
Facing: Public user / owner
Category: User-visible copy issue

### P2-3: Map SEO And Empty-State Copy Still Over-indexes On Deals

Route: `/map`
Repro: Inspect page metadata and empty states.
Expected: Map copy reflects current mixed map surface: live trucks, scheduled trucks, hosts, suppliers, parking, and deals.
Actual: SEO title says `Find Deals Near You`, and one empty state says `No deals nearby. Try expanding your search area.`
Impact: Users may misunderstand the map as a deals-only surface.
Evidence: `client/src/pages/map.tsx:101`, `client/src/pages/map.tsx:4917`
Screenshot marker: `screenshot-map-deals-copy`
Facing: Public user
Category: User-visible copy issue

### P2-4: Map Location Confidence Labels Need More Plain-Language Trust Context

Route: `/map`
Repro: Inspect truck status labels for non-live/non-scheduled locations.
Expected: Labels explain whether a pin is live, scheduled, static, or historical in user-safe language.
Actual: Status labels include `Static location` and `Last known location` without additional context near the inspected label formatter.
Impact: Users may over-trust stale or non-live truck locations.
Evidence: `client/src/pages/map.tsx:594`
Screenshot marker: `screenshot-map-last-known-location-context`
Facing: Public user
Category: Product trust risk

### P2-5: Owner Setup Profile Form Is URL-Heavy Instead Of Upload/Guided

Route: `/restaurant-owner-dashboard?setup=profile`
Repro: Open setup profile panel.
Expected: Owner setup uses clear guided fields and upload-first media language.
Actual: Setup fields include `Logo image URL`, `Cover image URL`, and many provider URL fields in the same setup surface.
Impact: Non-technical owners may stall during setup or paste low-quality links.
Evidence: `client/src/pages/restaurant-owner-dashboard.tsx:2191`, `client/src/pages/restaurant-owner-dashboard.tsx:2201`
Screenshot marker: `screenshot-owner-setup-url-heavy`
Facing: Owner
Category: User-visible copy issue

### P2-6: Setup Profile Panel Mixes Profile Basics, QR Kit, And Attribution Metrics

Route: `/restaurant-owner-dashboard?setup=profile`
Repro: Open setup mode and scan the profile workspace.
Expected: Setup flow emphasizes the next required profile action and keeps analytics/QR tools secondary.
Actual: The setup route includes profile basics, QR kit entry points, completion actions, and owner value attribution content.
Impact: Owners may not understand which step matters first, especially on mobile.
Evidence: `client/src/pages/restaurant-owner-dashboard.tsx:2008`, `client/src/pages/restaurant-owner-dashboard.tsx:2982`
Screenshot marker: `screenshot-owner-setup-density`
Facing: Owner
Category: Product trust risk

### P3-1: Public Schedule Empty State Uses System-ish Copy

Route: `/p/:entityType/:id`
Repro: Open a truck profile with no schedule.
Expected: Friendly public copy such as "No schedule posted yet."
Actual: The UI says `Schedule: none found.`
Impact: Minor polish issue; reads like an internal lookup result.
Evidence: `client/src/pages/public-profile.tsx:1642`
Screenshot marker: `screenshot-public-profile-schedule-none-found`
Facing: Public user
Category: User-visible copy issue

### P3-2: Public Profile Can Display Raw-ish Schedule Status Strings

Route: `/p/:entityType/:id`
Repro: Inspect current/today/next schedule stop badges.
Expected: Public-facing stop status labels should be explicitly mapped.
Actual: The badge uses `String(stop.status).replace(/_/g, " ")`, which can surface backend enum wording if new statuses are introduced.
Impact: Metadata leakage risk and inconsistent copy.
Evidence: `client/src/pages/public-profile.tsx:1546`
Screenshot marker: `screenshot-public-profile-stop-status-enum`
Facing: Public user
Category: Internal DB/schema parameter name risk

### P3-3: Owner Value Completion Metrics Can Expose Raw Internal Keys

Route: `/restaurant-owner-dashboard?setup=profile`
Repro: Inspect completion action fallback labels.
Expected: All completion metric names use owner-friendly labels.
Actual: Fallback text can display `${action.missingItemKey} update clicked`, and reconciliation output can show raw key strings.
Impact: Internal key leakage into owner/admin-visible UI.
Evidence: `client/src/pages/restaurant-owner-dashboard.tsx:3228`, `client/src/pages/restaurant-owner-dashboard.tsx:3244`
Screenshot marker: `screenshot-owner-dashboard-missing-item-key`
Facing: Owner/admin
Category: Internal DB/schema parameter name risk

### P3-4: Owner Booking Status Badge Can Display Raw Status Values

Route: `/restaurant-owner-dashboard?setup=profile`
Repro: Inspect booking cards in owner dashboard.
Expected: Booking statuses are mapped to title-case owner labels.
Actual: The badge displays `{booking.status}` directly.
Impact: Minor operator/owner terminology risk if backend statuses expand.
Evidence: `client/src/pages/restaurant-owner-dashboard.tsx:5090`
Screenshot marker: `screenshot-owner-booking-status-raw`
Facing: Owner
Category: Internal DB/schema parameter name risk

### P3-5: Admin Moderation Queue Uses Raw-ish Operator Labels

Route: `/admin/moderation/queue` (closest registered admin queue)
Repro: Inspect case list/detail panel.
Expected: Operator labels are clear, consistent, and formatted.
Actual: Priority is displayed directly, detail title uses `Recommendation FLAG` / `Profile Content FLAG`, and resolution outcome badge displays raw outcome.
Impact: Admin-only polish issue; not public-facing, but can slow review.
Evidence: `client/src/pages/admin/ModerationQueue.tsx:217`, `client/src/pages/admin/ModerationQueue.tsx:234`, `client/src/pages/admin/ModerationQueue.tsx:312`
Screenshot marker: `screenshot-admin-moderation-raw-labels`
Facing: Admin/operator
Category: Operator/admin-only terminology

## Raw Metadata Leakage Sweep

Searched for: `mutationAllowed: false`, raw booleans/enums, unformatted ISO timestamps, UUIDs where names are needed, unescaped HTML, internal action state names, JSON-like objects, and `null` / `undefined` / empty-array leakage across the target surfaces.

Findings:

- No visible `mutationAllowed: false` string found on target surfaces.
- No unescaped HTML rendering risk was found in the inspected target files.
- Public profile raw-ish enum risk: schedule status badge maps only underscores to spaces.
- Owner/admin raw enum risks: completion `missingItemKey`, booking `status`, moderation `priority`, moderation resolution `outcome`.
- Map internally generates ISO timestamps for report payloads, but those are POST payloads and were not found as visible copy in the inspected static surface.
- UUID leakage was not proven on the target public views in this static pass; a browser/data pass should still inspect cards with real payloads.

## Classification Summary

User-visible copy issues:

- P2-1 Homepage auth-first value communication
- P2-2 Ambiguous `Pick your path`
- P2-3 Map deals-heavy copy
- P2-5 Owner setup URL-heavy labels
- P3-1 `Schedule: none found.`

Internal DB/schema parameter name risks:

- P3-2 Public schedule `stop.status`
- P3-3 Owner completion `missingItemKey`
- P3-4 Owner booking `booking.status`

Operator/admin-only terminology:

- P1-2 Missing requested OCR queue route
- P3-5 Admin moderation raw-ish labels

Product trust risks:

- P1-1 Missing public unverified/unclaimed status
- P2-4 Map stale/static location confidence labels
- P2-6 Setup profile density and mixed priorities

## Fix Lane Order

1. Public trust badge lane: add visible unverified/unclaimed status for seeded profiles without changing owner-approved truth.
2. Admin OCR queue routing lane: either register `/admin/mealscout-review-queue` to the intended review surface or update process docs/routes to the actual queue.
3. Homepage/discovery copy lane: make anonymous discovery and owner paths obvious on first viewport.
4. Map trust/copy lane: rebalance copy away from deals-only language and add clear confidence explanations for non-live pins.
5. Owner setup simplification lane: separate required profile basics from QR/analytics and replace URL-first media fields with guided/upload language.

## Validation Plan And Results

- `npm run check`: PASS
- `npm run lint --if-present`: PASS / no lint script output
- `git diff --check`: PASS

`npm run test --if-present` was intentionally not run in this audit pass because this repo's `test` script invokes the targeted test runner and is not scoped to the evidence-only UX audit without selecting a target.

## Final Audit Assertion

This report is evidence-only. It does not approve claim emails, live DB import, public exposure changes, profile verification, owner-approved menu publication, runtime refactor, or new feature work.
