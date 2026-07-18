# MealScout Launch Surface Audit

Date: 2026-06-11
Branch: main
Local baseline commit before this pass: `33b44685b204d54348f820e3759bdea471cd95ab`

## Decision

PUBLIC PROFILE SHARE/COPY P0 PASSED

MealScout production now serves the public profile Share/Copy fix from commit `b5736159fd65c95ee61a104e3c28357a87fdaec7`, and the public profile Share/Copy runtime smoke passed on 2026-06-11. The native share payload and copied link both resolve to canonical attributed URLs when attribution context exists. The broader launch decision still depends on the remaining P1 launch risks and the 10-profile real-data checklist.

Core product doctrine:

- Scout visibility / public profile presence = core discoverability.
- Deals = optional marketing/promotional tool for owners/restaurants.
- Deals must not gate Scout visibility.
- Public profiles must be useful without deals.
- Missing menu/schedule/location data must be honest, not invented.
- Final share/copy/QR payloads must use canonical attributed URLs when attribution exists.

## P0 Blockers

| Status | Blocker | Resolution |
| --- | --- | --- |
| Fixed locally | Public profile had no visible Share control. | Added `button-public-profile-share` in `client/src/pages/public-profile.tsx`. |
| Fixed locally | Public profile had no visible Copy Link control. | Added `button-public-profile-copy-link` in `client/src/pages/public-profile.tsx`. |
| Fixed locally | Public profile Share/Copy attribution was not contract-protected. | Extended `scripts/mealscout-native-share-attribution.contract.test.ts`. |
| Passed | Production serves this pass. | `/api/version` reports `b5736159fd65c95ee61a104e3c28357a87fdaec7`. |
| Passed | Public profile Share/Copy runtime smoke. | Native share payload and copied link both use the canonical attributed URL shape. |

## P1 Risks

- Scout/discovery has existing menu-based quality gating in contracts. This is not a deals gate, but product should explicitly confirm whether zero-menu profiles should appear in all Scout contexts or only public profile/search contexts.
- Owner dashboard and admin/staff launch readiness were checked by static contracts and route inventory only in this pass; a credentialed production smoke is still needed.
- QR is currently treated as owner-dashboard-only based on inspected owner dashboard QR code paths. Anonymous public profile QR is not required unless product decides to expose it.
- Production route checks confirmed SPA responses, but not authenticated owner/admin flows.
- A fully empty menu state on public profiles is currently handled by omission when there is no menu evidence at all; this is honest and non-blocking, but product can still decide later whether that should become a visible informational card.

## P2 Polish

- Some older copy still emphasizes deals heavily as a value prop. It does not appear to gate Scout visibility, but future copy should rebalance toward public profiles, schedules, menus, and location truth.
- Public profile share controls are functional and visible, but can be refined visually after launch smoke.

## Surface Status

| # | Surface | Status | Notes |
| --- | --- | --- | --- |
| 1 | Public Profile | P0 passed | Share and Copy Link controls are visible in production and produce canonical attributed URLs. Menu/logo/schedule contract passes. |
| 2 | Scout / Discovery | P1 | Existing contracts prove unified truck discoverability and no deals gate found in inspected Scout contract. Menu gating remains a product decision. |
| 3 | Map | Pass with caveat | Production map route returns 200. Prior smoke showed attributed fallback share URL. |
| 4 | City Landing Pages | P1 | City/share attribution covered by native share contract. Pensacola food-trucks route needs content review because production previously showed city-not-found in one smoke. |
| 5 | Deals | Pass with doctrine caveat | Deals-city share/copy attribution previously produced attributed URLs. Deals remain optional marketing, not visibility gate. |
| 6 | Menu | P1 | Public menu/logo/schedule contract passes. Data completeness for 10 launch profiles still needs market checklist. |
| 7 | Schedule / Location | P1 | Public profile renders honest schedule/location states. Static address vs live truck location remains a launch QA item. |
| 8 | Owner Dashboard | P1 | Owner QR/share code uses `resolveCanonicalShareUrlSync`. Credentialed smoke still needed. |
| 9 | Onboarding / Claim | P1 | Claim/update route is linked from public profile header. Full claim/provider smoke not run in this pass. |
| 10 | Share / Copy / QR / Affiliate | P0 passed for public profile | Public profile Share/Copy use `resolveCanonicalShareUrl`; production smoke confirms attributed output. Map/city/deals/deal detail/owner QR are contract-covered. |
| 11 | Admin / Staff Review | P1 | Admin/staff contracts exist, but credentialed production review smoke not run. |
| 12 | Search / Filters | P1 | Search routes/tests exist; full production search smoke not run. Must not require deals. |
| 13 | Mobile UX | P1 | Public profile controls added in mobile-friendly flex row. Visual mobile smoke required after deploy. |
| 14 | Auth / Session | P1 | Public profile viewing/sharing is anonymous. Owner/admin session smoke requires credentials. |
| 15 | Notifications / Email | P2 | Not launch-blocking for public profile usefulness unless a specific claim/review email is required. |
| 16 | Production Freshness | Pass | `/api/version` reports production commit `b5736159fd65c95ee61a104e3c28357a87fdaec7`. |
| 17 | Data Quality / Imports | P1 | No fake data added. Ten-profile real-data launch checklist remains required. |
| 18 | SEO / Social Preview | P1 | Public profile SEO metadata is present. Social preview quality needs post-deploy URL inspection. |
| 19 | Error / Empty States | P1 | Public profile missing states are present for menu/schedule. Broader empty-state review remains useful. |

## Files And Routes Inspected

- `client/src/pages/public-profile.tsx`
- `client/src/lib/share.ts`
- `client/src/components/share-hub.tsx`
- `client/src/components/share-button.tsx`
- `client/src/components/ShareButton.tsx`
- `client/src/pages/explore-preview-v2.tsx`
- `client/src/pages/city-landing.tsx`
- `client/src/pages/deals-city.tsx`
- `client/src/pages/deal-detail.tsx`
- `client/src/pages/restaurant-owner-dashboard.tsx`
- `server/routes/locationUtilityRoutes.ts`
- `server/routes/restaurantOperationsRoutes.ts`
- `server/routes/publicDiscoveryRoutes.ts`
- `server/shareRoutes.ts`
- `server/shareMiddleware.ts`
- `server/shareTargetPolicy.ts`
- `scripts/mealscout-native-share-attribution.contract.test.ts`
- `scripts/public-profile-menu-logo-schedule.contract.test.ts`
- `scripts/scout-obsolete-surface-removal.contract.test.ts`
- `scripts/owner-discoverability-menu-state.contract.test.ts`

Production routes checked:

- `https://www.mealscout.us/p/location/a5d30bff-1318-4d7a-8ee2-96190bbf378f/the-spot-tavern`
- `https://www.mealscout.us/p/restaurant/49672377-82d2-4de6-abf3-0788b04028f7/3-d-eats`
- `https://www.mealscout.us/map`
- `https://www.mealscout.us/share-hub`
- `https://www.mealscout.us/deals/pensacola`
- `https://www.mealscout.us/api/version`
- `https://www.mealscout.us/api/health`

## Commands Run

```text
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
rg --files | rg "(public-profile|share|discover|search|owner-dashboard|menu|schedule|admin|staff|profile|launch|contract|smoke|test)"
rg -n "deal.*(required|visibility|appear|Scout|discover)|Scout.*deal|coming soon|sample|placeholder|fake|Share button|Copy Link|navigator\\.share|clipboard\\.writeText|resolveCanonicalShareUrl|ShareButton" client/src scripts docs server shared -S
npm run check
npx --yes tsx scripts/mealscout-native-share-attribution.contract.test.ts
npx --yes tsx scripts/public-profile-menu-logo-schedule.contract.test.ts
npx --yes tsx scripts/scout-horizontal-rails-ux.contract.test.ts
npx --yes tsx scripts/owner-discoverability-menu-state.contract.test.ts
node scripts/smokeScoutSurface.mjs
Invoke-WebRequest https://www.mealscout.us/api/version
Invoke-WebRequest https://www.mealscout.us/api/health
Invoke-WebRequest key production routes
Playwright production smoke for public profile Share/Copy with navigator.share and clipboard interception
```

## Smoke Artifacts

Production freshness before this pass:

```json
{
  "commit": "33b44685b204d54348f820e3759bdea471cd95ab",
  "buildTime": "2026-06-11T14:52:27.085Z",
  "environment": "production",
  "frontendAssetManifest": true
}
```

Production route smoke before this pass:

```text
/p/location/a5d30bff-1318-4d7a-8ee2-96190bbf378f/the-spot-tavern -> 200
/p/restaurant/49672377-82d2-4de6-abf3-0788b04028f7/3-d-eats -> 200
/map -> 200
/share-hub -> 200
/deals/pensacola -> 200
```

Prior live share smoke evidence from the native attribution hotfix:

```text
Map share/copy fallback -> https://www.mealscout.us/map/smoke-ref?lat=39.82830&lng=-98.57950&z=16
Deals city share/copy fallback -> https://www.mealscout.us/deals/pensacola/smoke-ref
```

Scout surface smoke:

```text
[smoke:scout-surface] base=https://mealscout.onrender.com
[live] mode: discovery
[live] sections: Today Around You(10), Recommended Nearby(3), More Nearby(3)
[live] markers: 3
[quiet] mode: discovery
[quiet] sections: Today Around You(8)
[quiet] markers: 0
[smoke:scout-surface] PASS
```

### Production Public Profile Share/Copy Smoke - 2026-06-11

| Item | Result |
| --- | --- |
| Production deploy freshness | PASS |
| Commit reported by `/api/version` | `b5736159fd65c95ee61a104e3c28357a87fdaec7` |
| Environment | `production` |
| Build time | `2026-06-11T16:14:16.054Z` |
| Public profile URL tested | `https://www.mealscout.us/p/location/a5d30bff-1318-4d7a-8ee2-96190bbf378f/the-spot-tavern` |
| Share button visible | Yes |
| Copy Link visible | Yes |
| Native share observed URL shape | `https://www.mealscout.us/p/location/<locationId>/<slug>/<ref>` |
| Native share observed URL | `https://www.mealscout.us/p/location/a5d30bff-1318-4d7a-8ee2-96190bbf378f/the-spot-tavern/smoke-ref` |
| Copied link observed URL shape | `https://www.mealscout.us/p/location/<locationId>/<slug>/<ref>` |
| Copied link observed URL | `https://www.mealscout.us/p/location/a5d30bff-1318-4d7a-8ee2-96190bbf378f/the-spot-tavern/smoke-ref` |
| Raw `/p/location/<id>` final output | No |
| QR status | Owner-dashboard-only |
| PASS/FAIL decision | PASS |
| Remaining blocker | None for public profile Share/Copy P0 |

Notes:

- Automation cannot read the OS-native share sheet UI directly, so the smoke intercepted the production `navigator.share(...)` payload. That payload is the URL handed to the native share sheet.
- Anonymous `/api/share/generate` returned 401 during the smoke, as expected without login. The canonical resolver then used the captured referral context from `localStorage.affiliate_ref = "smoke-ref"` and produced a clean path-style attributed URL.

### Public Profile Incomplete-State Trust Pass - 2026-06-11

Decision:
PASS

Protected incomplete states confirmed by code inspection and contracts:

- Missing logo/photo:
  `HeroBlock` falls back from `spotImageUrl` / `coverImageUrl` / `logoUrl` / `profileImageUrl` / `truckPhotoLogo` to initials artwork instead of inventing imagery.
- Missing menu but menu evidence exists:
  `MenuSection` renders `Menu unavailable right now.` when menu completeness resolves to `unavailable`.
- Partial menu evidence:
  `MenuSection` renders `Partial menu from available evidence. More items may be available from this business directly.`
- Missing truck schedule / live status:
  `RestaurantSchedule` and `HeroBlock` honor `schedule.statusLabel`, which supports honest text like `No schedule posted`.
- Missing live location coordinates on host profiles:
  `LocationMapSection` renders `Map coordinates are not available yet.` instead of fake coordinates.
- No trucks currently listed at a host:
  `LocationNowSection` and `LocationTruckOptionsSection` render `No trucks listed right now` plus `Check back soon or explore nearby food.`
- No deals present:
  `DealsSection` returns `null` when `dealItems.length === 0`, so deals stay optional and do not block profile usefulness or visibility.

Coverage added in this slice:

- `scripts/public-profile-menu-logo-schedule.contract.test.ts` now protects:
  hero image fallback,
  honest menu unavailable state,
  honest missing-coordinates state,
  honest no-trucks state,
  optional deals absence.

Gap found:

- No P0 trust bug found.
- Remaining product nuance: when there is zero menu evidence at all, the page omits the menu card entirely rather than showing an explicit “menu unavailable” note. That is still honest and does not block profile usefulness, so this stays a P1 product decision rather than a bug.

### Owner Onboarding / Claim-to-Profile Trust Pass - 2026-06-11

Decision:
PASS

Owner/admin trust protections confirmed by code inspection and existing contracts:

- Claim/profile attach behavior:
  `scripts/business-owner-attachment-invariant.contract.test.ts` protects attached, pending-claim, pending-invite, admin-import-draft, orphan-repair, and create-and-attach business states so owner/admin surfaces do not pretend a broken attachment is complete.
- Owner/business access linkage:
  `scripts/business-user-ownership-link.contract.test.ts` requires business team flows to keep explicit connect/claim language, including `Connect or claim your business to continue.`
- Setup link and post-verification honesty:
  `client/src/pages/account-setup.tsx` and `scripts/mealscout-auth-onboarding-alignment.contract.test.ts` protect setup-link-required, invalid-link, token-required, and safe continuation behavior. The setup completion copy explicitly says: verify email, then connect or claim your business profile if you are an owner.
- Claim flow next action clarity:
  `client/src/pages/claim-truck.tsx` exposes search, claim, and setup-reminder paths with explicit fallback guidance when email delivery or admin setup is needed. It does not frame deals as a prerequisite for visibility or claiming.
- Owner setup routing clarity:
  `scripts/owner-dashboard-setup-routing.contract.test.ts` protects setup-mode deep links for profile, menu, profile media, and schedule so owners can land directly on the next missing setup area.
- Owner setup gating:
  `scripts/owner-dashboard-setup-gating.contract.test.ts` protects setup-mode affordances such as business onboarding, menu builder, and schedule/live tools so missing work is surfaced as work to complete rather than silently assumed complete.
- Missing profile data honesty/actionability:
  `scripts/owner-profile-completion.contract.test.ts` requires explicit missing-state labels including `Menu missing`, `Photos missing`, `Business hours missing`, `Service area missing`, `Contact method missing`, `Social link missing`, `Catering/private event info missing`, `Deal/special missing`, plus `Update next missing item`.
- Shared completion doctrine:
  `scripts/owner-profile-completion-status.contract.test.ts` protects the shared completion-status adapter used by owner UI and reconciliation logic. Deals are tracked as optional completion context and not as a gate for profile existence.
- Public discoverability and menu-state safeguards:
  `scripts/owner-discoverability-menu-state.contract.test.ts`, `scripts/scout-horizontal-rails-ux.contract.test.ts`, `scripts/scout-truck-menu-schedule-regression.contract.test.ts`, and `scripts/public-profile-menu-logo-schedule.contract.test.ts` confirm discoverability and public-profile honesty without requiring deals.
- Claim-to-useful-profile reconciliation:
  `scripts/mealscout-claim-profile-update-reconciliation.contract.test.ts` protects launch reporting around claimed profiles becoming useful with real menu, schedule, contact, and photo evidence, while forbidding fake/sample/generated data markers.

Launch-audit conclusion for this slice:

- Deals are optional in owner/admin setup surfaces: YES.
- Missing profile data is honest and actionable: YES.
- Public visibility is not blocked by deals in the inspected owner/claim/setup flows.
- No P0 owner onboarding or claim-to-profile trust bug was found in this pass.

Known non-blocking note:

- Owner dashboard completion still includes `Deal/special missing` as an optional improvement prompt. In the current protected copy and status model, this is framed as a marketing enhancement rather than a Scout visibility gate.

### Referral / Attribution Integrity Pass - 2026-06-11

Decision:
PASS

Existing attribution protections confirmed by code inspection and contracts:

- Canonical share generation:
  `client/src/lib/share.ts`, `server/shareRoutes.ts`, and `server/shareTargetPolicy.ts` centralize canonical attributed URL generation, reject nested `to=` / query `ref` drift in generated links, and preserve clean path-segment attribution.
- Silent fallback behavior:
  `resolveCanonicalShareUrl(...)` only falls back to a direct canonical URL when no authenticated tracked link can be generated and no stored fallback attribution ref exists. When a fallback ref exists and the target is eligible, it still produces a canonical attributed path. `server/shareRoutes.ts` fail-closes with `401 authentication_required`, `409 attribution_identity_required`, or `409 share_target_required` rather than silently assigning a default/system identity.
- Invalid/default referral tag rejection:
  `server/shareRoutes.ts`, `client/src/pages/referral-redirect.tsx`, `server/routes/systemUtilityRoutes.ts`, and `scripts/mealscout-valid-ref-production-smoke.contract.test.ts` all preserve rejection of default-looking `userNNNN` tags.
- Hydration and redirect preservation:
  `client/src/hooks/useAuth.ts`, `client/src/pages/referral-redirect.tsx`, `server/index.ts`, and `scripts/mealscout-affiliate-referral-capture.contract.test.ts` preserve `?ref=` and path-segment refs through client capture, redirect compatibility, and server cookie capture before SPA/static handlers.
- Auth/setup redirect safety:
  `scripts/mealscout-auth-onboarding-alignment.contract.test.ts`, `scripts/login-continuation.contract.test.ts`, and `scripts/app-unification-dashboard-entry.contract.test.ts` protect continuation-path safety so auth/setup redirects do not bounce users through unsafe `/account-setup` continuation loops or strip guarded continuation state.
- QR canonicality:
  `client/src/pages/restaurant-owner-dashboard.tsx` resolves `publicProfileForQr.seo.canonicalUrl` through `resolveCanonicalShareUrlSync(...)` before building Profile QR, Menu QR, Specials QR, truck assets, and QR-kit copy actions.
- Public share/copy canonicality:
  Public profile Share/Copy production smoke remains documented above and still confirms canonical attributed output when attribution context exists.

Fix completed in this slice:

- Owner dashboard discovery empty-state copy now routes through `resolveCanonicalShareUrl(publicProfilePath)` before writing to the clipboard.
- `scripts/mealscout-native-share-attribution.contract.test.ts` now explicitly guards this owner-dashboard copy path against regression back to `navigator.clipboard.writeText(fullUrl)`.

Launch-audit conclusion for this slice:

- Public Share/Copy canonical attribution remains protected: YES.
- QR/referral payloads remain canonical in the inspected QR kit paths: YES.
- Invalid/default referral tags remain rejected: YES.
- Hydration/redirect attribution preservation status: PASS by current contracts and inspected code.
- Silent fallback behavior: FAIL-CLOSED on the server and attributed when a valid fallback ref exists on the client; no default/system attribution path was found.
- Referral / attribution integrity decision: PASS.

### Clean URL Doctrine / Stage 1 Migration - 2026-06-11

Decision:
PASS for doctrine lock and first migration slice

Doctrine status:

- `docs/MEALSCOUT_CLEAN_URL_DOCTRINE.md` now locks the target product rule:
  final public profile architecture should move to root-level clean slugs such as `/{businessSlug}` and clean subpaths.
- Stage 1 migration is narrower:
  launch-critical user-facing outputs must stop treating `/p/...` as canonical final output and should use cleaner public route families first.

Current classification:

- Clean public/user-facing in Stage 1:
  `/restaurant/{slug}--{id}`,
  `/truck/{slug}--{id}`,
  `/bar/{slug}--{id}`,
  `/location/{slug}--{id}`,
  `/supplier/{slug}--{id}`
- Acceptable internal/admin/API:
  `/api/*`, `/admin/*`, `/staff/*`, guarded auth/setup internals
- Legacy/backward-compatible only:
  `/p/:profileType/:profileId/:profileSlug`,
  `/ref/:tag?to=...`
- Launch-blocking ugly final public output:
  any launch-critical share/copy/QR/marketing/onboarding/profile link that still emits `/p/location` or other `/p/...` profile canonical output

Stage 1 correction implemented:

- Public profile canonical/profile paths now emit cleaner public route families instead of `/p/...`.
- Public profile share/copy/QR surfaces inherit those cleaner canonical paths through the profile payloads and canonical URL builders.
- App route aliases now allow cleaner public profile route families to render the real public profile surface directly, while legacy `/p/...` routes remain supported.
- City landing, scout adapters, map host links, share hub self-profile links, and onboarding-owned profile links were moved onto the cleaner route family helpers in this slice.

Known remaining risks:

- Root-level `/{businessSlug}` routing is still not implemented. Stage 1 uses route-family clean URLs, not final root-level clean slugs.
- Collision handling is still using deterministic `slug--id` route tokens in this slice. That is safer than `/p/...` canonical output, but it is not the final no-ID doctrine end state.
- Some internal/admin and analytics references still mention legacy `/p/...` routes for compatibility or historical event data and should be treated as non-canonical.

Affiliate clean-tag doctrine correction:

- Preferred final user-facing affiliate shape is `https://www.mealscout.us/{businessSlug}/{affiliateTag}`.
- Invalid/default affiliate tags such as `userNNNN` must remain rejected.
- Final user-facing affiliate URLs must not expose `/p/location`, `/referral-redirect`, UUIDs, raw IDs, or query-heavy tracking params.
- This branch does not yet satisfy that final affiliate doctrine end state because Stage 1 public profile routes still rely on `slug--id` migration paths.
- Current status is therefore:
  attribution integrity can pass,
  Stage 1 route-family migration can pass,
  final clean affiliate URL doctrine remains an explicit follow-up slice and must not be treated as done.

## Required Fixes Before Launch

1. Run a 10-profile data checklist: real identity, menu if available, schedule/location truth, no fabricated data, discoverable without deals, shareable with attribution.
2. Credentialed owner dashboard smoke: profile link, share controls, menu status, schedule/location status, owner-dashboard QR.
3. Credentialed admin/staff smoke: profile-quality review, duplicate/conflict visibility, public-ready vs needs-owner-info states.
4. Product decision: confirm whether zero-menu profiles should appear in all Scout contexts or only public profile/search contexts.
5. Final clean affiliate URL architecture: move user-facing affiliate/share/copy/QR/email/onboarding outputs from `slug--id` migration paths to no-ID public URLs such as `/{businessSlug}/{affiliateTag}`.
