# MealScout Repo Lanes

## Repo

MealScout

## Repo Doctrine

- Scout visibility / public profile presence = core discoverability.
- Deals = optional marketing/promotional tool for owners/restaurants.
- Deals must not gate Scout visibility.
- Public profiles must be useful without deals.
- No fake/sample/generated data in launch-critical surfaces.
- Missing menu, schedule, and location states must be honest and actionable.
- Every share/copy/QR final payload must use canonical attributed URLs when attribution exists.
- Do not import doctrine, copy, naming, or assumptions from another Thomas / TradeScout brand.
- `npm` and `package-lock.json` are the only package-manager source of truth. Do not add a secondary lockfile.
- Point-in-time API scans, dependency snapshots, local Vite logs, and visual-review captures are output, not source. Keep them outside tracked runtime paths unless a current contract explicitly consumes them.
- Route and surface decisions come from `client/src/App.tsx`, `client/src/lib/app-route-surface.ts`, and the currently served implementation. Historical screenshots and removed components cannot override them.

## Safe Parallel Lanes

| Lane | Purpose | Typical Branch |
| --- | --- | --- |
| `docs-ops` | Repo operating docs, lane definitions, handoff rules | `codex/docs/parallel-execution` |
| `public-profile` | Public profile rendering, identity, Share/Copy controls, SEO metadata | `codex/public-profile/<scope>` |
| `share-attribution` | Canonical share/copy/QR resolver, referral capture, attribution contracts | `codex/share-attribution/<scope>` |
| `scout-discovery` | Scout/discovery visibility, search/filter routing, no deals gate | `codex/scout-discovery/<scope>` |
| `map-city-discovery` | Map, city landing, location discovery surfaces | `codex/map-city/<scope>` |
| `menu-schedule-location` | Menu display, schedule truth, static/live location clarity | `codex/menu-schedule/<scope>` |
| `owner-dashboard` | Owner dashboard profile controls, menu/schedule status, owner QR/share | `codex/owner-dashboard/<scope>` |
| `onboarding-claim` | Claim/start profile flows, duplicate/conflict states | `codex/onboarding-claim/<scope>` |
| `admin-staff-review` | Staff/admin review queues, profile quality, duplicate/conflict visibility | `codex/admin-staff/<scope>` |
| `tests-contracts` | Narrow contracts/smokes for a single assigned product lane | `codex/contracts/<scope>` |
| `production-smoke` | Production freshness checks and documented smoke artifacts only | `codex/production-smoke/<scope>` |

## Unsafe Lane Pairings

Do not run these lanes in parallel without Gawain merge ordering:

| Lane A | Lane B | Risk |
| --- | --- | --- |
| `public-profile` | `share-attribution` | Same share/copy call sites and contracts. |
| `public-profile` | `menu-schedule-location` | Same profile render tree and empty states. |
| `scout-discovery` | `map-city-discovery` | Shared discovery assumptions and route behavior. |
| `scout-discovery` | `tests-contracts` | Contract assertions may race behavior changes. |
| `owner-dashboard` | `share-attribution` | Owner QR/share target generation can conflict. |
| `owner-dashboard` | `onboarding-claim` | Shared owner state and profile readiness assumptions. |
| `admin-staff-review` | `onboarding-claim` | Shared approval, duplicate, and review states. |
| Any product lane | `docs-ops` touching lane policy for that same area | Doctrine/allowed-file changes can invalidate the product prompt. |

## Branch Naming Convention

```text
codex/<lane-name>/<short-scope>
```

Rules:

- Use lowercase kebab-case.
- Keep one branch tied to one lane.
- Do not reuse a lane branch for unrelated work.
- If scope expands, report it before editing outside the original lane.

## Lane File Boundaries

### `docs-ops`

Allowed:

- `docs/AI_PARALLEL_EXECUTION.md`
- `docs/REPO_LANES.md`
- narrowly related operating docs if assigned

Banned:

- `client/**`
- `server/**`
- `shared/**`
- `scripts/**`
- package or build configuration unless explicitly assigned

### `public-profile`

Allowed:

- `client/src/pages/public-profile.tsx`
- profile-specific UI components if already used by public profiles
- public profile contracts in `scripts/public-profile*.test.ts`
- share attribution contract only when public profile Share/Copy behavior is the assigned scope

Banned unless explicitly assigned:

- owner dashboard internals
- admin/staff routes
- payment/subscription files
- unrelated map/city/deals surfaces

### `share-attribution`

Allowed:

- `client/src/lib/share.ts`
- `server/shareRoutes.ts`
- `server/shareMiddleware.ts`
- `server/shareTargetPolicy.ts`
- share/referral contracts in `scripts/*share*`, `scripts/*referral*`
- call sites explicitly named in the lane prompt

Banned unless explicitly assigned:

- payout/payment/Stripe code
- unrelated product copy
- broad dashboard refactors

### `scout-discovery`

Allowed:

- Scout/discovery pages and components
- discovery/search route handlers
- Scout/search contracts
- discovery copy directly tied to the assigned issue

Banned unless explicitly assigned:

- deals creation/management
- owner dashboard setup flows
- admin imports
- payment/subscription code

### `map-city-discovery`

Allowed:

- `client/src/pages/explore-preview-v2.tsx`
- `client/src/components/maps/google-map-surface.tsx`
- `client/src/components/maps/GoogleMapPicker.tsx`
- `client/src/pages/city-landing.tsx`
- `client/src/pages/deals-city.tsx` only for share/copy or city link behavior named in the lane
- map/city discovery contracts

Banned unless explicitly assigned:

- owner dashboard
- admin imports
- unrelated public profile rendering

### `menu-schedule-location`

Allowed:

- menu display/status files
- schedule/location display and truth-state files
- menu/schedule/location contracts

Banned unless explicitly assigned:

- fabricated seed data
- payment code
- unrelated share attribution mechanics

### `owner-dashboard`

Allowed:

- `client/src/pages/restaurant-owner-dashboard.tsx`
- owner dashboard components
- owner profile completion/status contracts

Banned unless explicitly assigned:

- public discovery ranking
- admin/staff review internals
- payment/subscription changes

### `onboarding-claim`

Allowed:

- claim/start profile pages
- account setup continuation files
- duplicate/conflict handling directly tied to onboarding
- onboarding/claim contracts

Banned unless explicitly assigned:

- public profile visual redesign
- admin bulk import behavior
- payment/subscription code

### `admin-staff-review`

Allowed:

- admin/staff review surfaces
- approval, duplicate, profile-quality review contracts
- staff/admin route handlers named in scope

Banned unless explicitly assigned:

- customer-facing public profile UI
- owner dashboard UX
- payment/subscription code

### `tests-contracts`

Allowed:

- tests/contracts for the assigned lane only
- small fixtures needed by those tests

Banned:

- product behavior changes unless the prompt explicitly expands the lane
- broad test runner rewrites

### `production-smoke`

Allowed:

- docs or artifacts recording smoke results
- smoke scripts only when assigned

Banned:

- application behavior changes
- fake production freshness
- unverified manual-smoke claims

## Validation Expectations

Always inspect `package.json` first. The normal validation command for this repo is:

```text
npm run check
```

Additional expectations:

- Product behavior lanes should run the closest contract or smoke scripts for their lane.
- Share/referral lanes should run the share and referral contract suite named in the prompt.
- Public profile lanes should run public profile contracts when present.
- Production-smoke lanes must report whether `/api/version` proves the expected commit.
- If a command is skipped, say why.

## Return Format

Every Codex lane must return:

- repo
- lane chosen
- branch
- baseline SHA
- files inspected
- files changed
- tests run
- test results
- commit SHA if committed
- PR link if opened
- final git status
- risks / follow-up needed

