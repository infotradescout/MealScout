# Scout / public-profile continuity acceptance

Date: 2026-09-17. Scope: PR #380, `codex/ui-ux-front-end-overhaul-20260915`.
Base: `28857357de34cebf0d4798c838d5883117dd9869`. Core continuation commit: `c6146b55`.
This is frontend acceptance, not production, native-auth, payment or map-provider acceptance.

## Implementation
`client/src/lib/scout-journey-state.ts` owns a versioned, validated, tab/account-scoped view snapshot with a 30-minute lifetime. Unresolved identity cannot read/write a guest snapshot. Expired, future-dated, malformed and wrong-account records do not restore. Denied storage does not break navigation.

Only search mode/query/filter, scene/craving, discovery radius, map center/zoom/expanded state/layers/selected marker identity, scroll position and a safe Scout return route are stored. No results, availability, booking/payment state, profile data or credentials are stored. OAuth codes/tokens/arbitrary redirect parameters are excluded from the return route; approved attribution/preview parameters survive.

The active `explore-preview-v2.tsx` owner restores through the existing search context and `useScoutJourneyPersistence`. The view remounts on account changes. Restored marker identity is resolved against current query data, not a serialized old entity. Scroll recovery is bounded and yields to user input. Current location/recenter and availability policies remain authoritative.

The existing profile header, unavailable-state and footer Scout links use the saved account-scoped route. The original visible Scout label and single-action-layer design remain; an unchanged shell contract caught an alternate label and the implementation was corrected rather than weakening that contract. Canonical/share URLs and profile economics are unchanged.

## Observed verification
- 41/41 Node cases: the previously unexecuted 19 profile-recovery cases plus 22 new Scout state cases; zero failures/skips.
- 13/13 affected existing regression checks covering profile shell/actions, quality signals, route resolution, map truth, claim prompts and affiliate/share protections.
- Full repository TypeScript check: explicit final exit 0.
- Actual Vite frontend build: exit 0 with an isolated environment and synthetic public test key. No backend/provider secrets supplied.
- 32/32 actual compiled-frontend browser scenarios: 16 each at 1440x900 and 390x844, installed Chrome, zero page exceptions.

Browser coverage includes guest Save/Recommend -> actual login UI -> exact original profile path/query/hash -> explicit action; no auto-mutation on login; acknowledged success, non-success and rapid duplicate clicks; quick-review modal close preserving recommendation; 503/malformed profile retry; 401/403/404/410; typed-slug resolver retry; account/expiry boundaries; seeded search/filter/scene/radius/layer/map-view restoration; reload/browser back; and an actual nonempty thin-market Scout View profile click and return to the attributed discovery route.

Save is measured at least 44x44px, Recommend at least 44px high; profile captures have no horizontal overflow. Both mobile/desktop profile screenshots were visually inspected.

## Durable gates
The existing preview executor retains all 20 stages and adds `scout-profile-state` and `public-profile-browser`. The new suites were successfully executed locally before adding them to the hosted gate. A future READY preview must not be described as a directly observed 22-stage summary unless that summary was read.

## Evidence and limits
Local evidence directory: `.qa-evidence/scout-continuity-20260917/`.
Receipts: `final-state-tests.log`, `profile-affected-contracts.log`, `final-typecheck.log`, `profile-browser-build.json`, `profile-browser-results.json`.
Captures: `profile-controls-390.png`, `profile-controls-1440.png`, `scout-roundtrip-390.png`, `scout-roundtrip-1440.png`.
Earlier failed browser receipts are preserved: modal assertions initially looked behind an open accessible dialog, generic fixture responses omitted discovery arrays, and a thin-market case initially assumed scene controls that that surface does not render. Corrected tests use the actual dialog/empty-data/thin-market behaviors; production authorization was not changed.

All browser APIs/auth responses and restaurant data are synthetic; external requests, service workers and WebSockets are blocked. The loopback server serves the real compiled frontend only. No real accounts, messages, charges, bookings, inventory or provider settings were changed. Live map-provider gestures/selection, native authentication, real Stripe, concurrent native booking capacity and the connected production-handler transaction chain remain unproved.

Next unproved UI acceptance: fuller-market map/result selection and menu/order/book/share continuation, followed by the existing onboarding/claim work. Do not restart completed recovery tests, Parking Pass polish or GitHub Actions startup investigation.
PR #381 remains separate. No merge or production migration. Retain migration 142 rollout order, drain legacy destructive expiry workers before new-worker activation, retain terminal booking history and earlier request tombstones.
