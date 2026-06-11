# MealScout Launch Surface Audit

Date: 2026-06-11
Branch: main
Local baseline commit before this pass: `33b44685b204d54348f820e3759bdea471cd95ab`

## Decision

NOT READY

MealScout is closer to launch readiness after this pass, but the launch decision remains NOT READY until the new public profile Share/Copy controls are deployed and visually smoked in production. Production currently serves the prior hotfix commit. The contained P0 fix in this pass adds the missing public profile Share and Copy Link controls and routes both through the canonical attributed URL resolver.

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
| Remaining | Production does not yet serve this pass. | Deploy this commit and rerun visual smoke on the public profile URL. |
| Remaining | Public profile native share sheet cannot be verified until deployment. | After deploy, verify the native share sheet URL is attributed/canonical. |

## P1 Risks

- Scout/discovery has existing menu-based quality gating in contracts. This is not a deals gate, but product should explicitly confirm whether zero-menu profiles should appear in all Scout contexts or only public profile/search contexts.
- Owner dashboard and admin/staff launch readiness were checked by static contracts and route inventory only in this pass; a credentialed production smoke is still needed.
- QR is currently treated as owner-dashboard-only based on inspected owner dashboard QR code paths. Anonymous public profile QR is not required unless product decides to expose it.
- Production route checks confirmed SPA responses, but not authenticated owner/admin flows.

## P2 Polish

- Some older copy still emphasizes deals heavily as a value prop. It does not appear to gate Scout visibility, but future copy should rebalance toward public profiles, schedules, menus, and location truth.
- Public profile share controls are functional and visible, but can be refined visually after launch smoke.

## Surface Status

| # | Surface | Status | Notes |
| --- | --- | --- | --- |
| 1 | Public Profile | P0 fixed locally | Share and Copy Link controls added. Menu/logo/schedule contract passes. Production smoke still required after deploy. |
| 2 | Scout / Discovery | P1 | Existing contracts prove unified truck discoverability and no deals gate found in inspected Scout contract. Menu gating remains a product decision. |
| 3 | Map | Pass with caveat | Production map route returns 200. Prior smoke showed attributed fallback share URL. |
| 4 | City Landing Pages | P1 | City/share attribution covered by native share contract. Pensacola food-trucks route needs content review because production previously showed city-not-found in one smoke. |
| 5 | Deals | Pass with doctrine caveat | Deals-city share/copy attribution previously produced attributed URLs. Deals remain optional marketing, not visibility gate. |
| 6 | Menu | P1 | Public menu/logo/schedule contract passes. Data completeness for 10 launch profiles still needs market checklist. |
| 7 | Schedule / Location | P1 | Public profile renders honest schedule/location states. Static address vs live truck location remains a launch QA item. |
| 8 | Owner Dashboard | P1 | Owner QR/share code uses `resolveCanonicalShareUrlSync`. Credentialed smoke still needed. |
| 9 | Onboarding / Claim | P1 | Claim/update route is linked from public profile header. Full claim/provider smoke not run in this pass. |
| 10 | Share / Copy / QR / Affiliate | P0 fixed locally | Public profile Share/Copy now use `resolveCanonicalShareUrl`; map/city/deals/deal detail/owner QR are contract-covered. |
| 11 | Admin / Staff Review | P1 | Admin/staff contracts exist, but credentialed production review smoke not run. |
| 12 | Search / Filters | P1 | Search routes/tests exist; full production search smoke not run. Must not require deals. |
| 13 | Mobile UX | P1 | Public profile controls added in mobile-friendly flex row. Visual mobile smoke required after deploy. |
| 14 | Auth / Session | P1 | Public profile viewing/sharing is anonymous. Owner/admin session smoke requires credentials. |
| 15 | Notifications / Email | P2 | Not launch-blocking for public profile usefulness unless a specific claim/review email is required. |
| 16 | Production Freshness | P0 remaining | `/api/version` proves production is fresh for `33b44685...`; it must be rechecked after this commit deploys. |
| 17 | Data Quality / Imports | P1 | No fake data added. Ten-profile real-data launch checklist remains required. |
| 18 | SEO / Social Preview | P1 | Public profile SEO metadata is present. Social preview quality needs post-deploy URL inspection. |
| 19 | Error / Empty States | P1 | Public profile missing states are present for menu/schedule. Broader empty-state review remains useful. |

## Files And Routes Inspected

- `client/src/pages/public-profile.tsx`
- `client/src/lib/share.ts`
- `client/src/components/share-hub.tsx`
- `client/src/components/share-button.tsx`
- `client/src/components/ShareButton.tsx`
- `client/src/pages/map.tsx`
- `client/src/pages/city-landing.tsx`
- `client/src/pages/deals-city.tsx`
- `client/src/pages/deal-detail.tsx`
- `client/src/pages/restaurant-owner-dashboard.tsx`
- `client/src/pages/scout-prototype.tsx`
- `server/routes/locationUtilityRoutes.ts`
- `server/routes/restaurantOperationsRoutes.ts`
- `server/routes/publicDiscoveryRoutes.ts`
- `server/shareRoutes.ts`
- `server/shareMiddleware.ts`
- `server/shareTargetPolicy.ts`
- `scripts/mealscout-native-share-attribution.contract.test.ts`
- `scripts/public-profile-menu-logo-schedule.contract.test.ts`
- `scripts/unified-truck-discoverability.contract.test.ts`
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
npx --yes tsx scripts/unified-truck-discoverability.contract.test.ts
npx --yes tsx scripts/owner-discoverability-menu-state.contract.test.ts
node scripts/smokeScoutSurface.mjs
Invoke-WebRequest https://www.mealscout.us/api/version
Invoke-WebRequest https://www.mealscout.us/api/health
Invoke-WebRequest key production routes
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

## Required Fixes Before Launch

1. Deploy this commit.
2. Confirm `/api/version` reports this commit or later.
3. Open `https://www.mealscout.us/p/location/a5d30bff-1318-4d7a-8ee2-96190bbf378f/the-spot-tavern`.
4. Confirm visible Share and Copy Link controls on desktop and mobile.
5. Click Share and confirm the native share sheet URL is attributed/canonical when attribution exists, not raw `/p/location/<id>`.
6. Click Copy Link and confirm the pasted URL is attributed/canonical when attribution exists.
7. Confirm QR remains owner-dashboard-only, or expose public profile QR and route it through the same resolver.
8. Run a 10-profile data checklist: real identity, menu if available, schedule/location truth, no fabricated data, discoverable without deals, shareable with attribution.
