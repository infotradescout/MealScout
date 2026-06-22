Status: `creativbowls logo-only apply hold packet`

# MealScout CREATIVBOWLS Logo-Only Apply Hold - 2026-06-22

## 1. Executive decision

Hold the `CREATIVBOWLS identity asset slice: apply logo only` lane.

Do not apply the logo to production yet.

Reason:

- the repo contains a real safe mutation path for logo apply
- live public profile truth is still compatible with a logo-only improvement
- but the required approval gate is not satisfied
- and the exact owned-site logo artifact could not be safely pinned on `2026-06-22` because the owned site currently returns `The website is not available`

This lane therefore stops before production mutation and returns an approval-ready apply packet instead.

## 2. Confirmed target profile and routes

Confirmed CREATIVBOWLS profile target:

- profile id: `75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- canonical route: `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- alias route: `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- public profile API: `https://mealscout.onrender.com/api/public/profiles/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`

Intended target field for a future apply:

- `restaurants.logoUrl`

Related upload/evidence path already present in repo:

- `POST /api/admin/profile-evidence/apply`
- existing direct media route: `POST /api/upload/restaurant-logo`

## 3. Current production and repo truth

Live public API truth observed on `2026-06-22`:

- profile response status: `200`
- `displayName`: `CREATIVBOWLS`
- `profileType`: `truck`
- `logoUrl`: empty / missing
- `coverImageUrl`: empty / missing
- `websiteUrl`: `https://creativbowls.company.site/`
- `facebookPageUrl`: empty / missing
- schedule label: `No schedule posted`
- schedule rows: `0`
- menu sections: `0`
- featured menu items: `0`

Repo evidence truth still aligned with the live API:

- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json` marks `CREATIVBOWLS` `logoStatus: "missing"` and `ownerApprovalNeeded: true`
- `docs/evidence/live-scout-truck-evidence-batch-3-2026-06-13.json` marks `logoEvidenceStatus: "sourced"` and `ownerApprovalNeeded: true`
- `docs/ops/MEALSCOUT_PRIORITY_THREE_THIN_PROFILE_TRUST_APPLY_PREP_2026-06-21.md` explicitly requires `owner-confirmed` approval or a strong `Knight-provided owner-style update` before logo apply

Competing production logo check:

- no competing production logo is present in the live public API
- current production truth is still `logo missing`

## 4. Safe existing mutation mechanism

The repo already contains a safe existing logo mutation path.

Safe existing mechanism:

- admin evidence apply route in `server/routes/admin/truckImportAdminRoutes.ts`
- manual intake runner in `scripts/runManualTruckIntakeSmokePacket.ts`
- production guard in `docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md`

Why this path is acceptable when approval exists:

- dry run is default
- production apply requires explicit `mode = apply`
- production-targeting requires explicit `--allow-production`
- existing logo is preserved unless overwrite approval is explicitly enabled
- uploaded logo is attached through the same Cloudinary/image upload path already used by the app

This means the blocker is not mutation-path invention.

The blocker is evidence and approval completeness.

## 5. Candidate logo artifact status

Current best candidate artifact source from repo evidence:

- owned site candidate: `https://creativbowls.company.site/`

Current candidate classification:

- `public-source observed`
- not `owner-confirmed`
- not `Knight-provided owner-style update`

Blocking artifact problem on `2026-06-22`:

- a direct fetch of `https://creativbowls.company.site/` returned a `Not available` page
- because of that, this lane could not safely capture the exact logo file URL
- this lane also could not safely record actual logo file dimensions, file size, or file format from the live owned site

Result:

- the candidate source is known
- the exact artifact is not pinned
- the exact artifact is therefore not approved for apply

## 6. Owner/Knight approval evidence status

Approval status is not sufficient for mutation.

Confirmed repo evidence:

- `docs/evidence/live-scout-truck-evidence-batch-3-2026-06-13.json` says the owned-site logo is a candidate only and `ownerApprovalNeeded: true`
- `docs/evidence/live-scout-truck-content-completion-2026-06-13.json` says `ownerApprovalNeeded: true`
- `docs/ops/MEALSCOUT_SIX_TRUCK_PUBLIC_PROFILE_TRUST_SLICE_2026-06-19.md` says `CREATIVBOWLS` still needs approval to use owned-site logo/cover/menu assets
- no later repo artifact was found that records:
  - explicit owner confirmation for logo usage
  - a Knight packet explicitly approving the exact logo file for apply
  - `ownerApproved: true` for this logo

Conclusion:

- approved logo artifact source: not yet confirmed
- owner/Knight approval evidence: not present in repo

## 7. Rendering constraints and safe bounds

### Public profile logo behavior

Public truck profile hero behavior from repo code:

- `client/src/components/public-profile/ProfileHeroMedia.tsx` renders logo in a dedicated avatar shell
- truck hero avatar shell size is `h-24 w-24`
- logo image renders with `object-cover`
- if logo fails to load, the hero falls back to initials
- logo-only truck profiles keep logo in the avatar slot and do not promote it into the cover slot

Fallback behavior:

- missing or failed logo renders initials fallback
- cover fallback remains a dark radial/gradient background

### Scout card behavior

Scout card behavior from repo code:

- `client/src/pages/scout-prototype.tsx` prefers `logoUrl` as the first business image candidate
- feed card image frame is `w-24 h-24`
- feed card image renders with `object-cover rounded-xl`

Practical implication:

- a future CREATIVBOWLS logo will act like a square card image on `/scout`
- transparent-edge logos or very wide marks may crop poorly in the 96x96 card frame

### Existing upload bounds

Existing technical bounds from repo:

- accepted server file class: `image/*`
- client guidance explicitly names `JPG`, `PNG`, and `WebP`
- max upload size: `5MB`
- Cloudinary upload transformation caps image dimensions to `1200x1200` with `crop: limit`
- generated thumbnail target is `300x300`

### Safe bounds for a later apply

Because the repo does not define stricter logo-specific constraints, the safe bounds for this lane should be:

- file type: `PNG`, `JPG`, or `WebP`
- file size: `<= 5MB`
- recommended aspect ratio: square or near-square
- recommended background: transparent or high-contrast against dark UI
- must remain legible when cropped with `object-cover` into:
  - `96x96` Scout card image usage
  - `96x96` public profile avatar shell usage

Dark/light safety note:

- the current public profile truck surface is dark-themed
- no separate light-mode-specific public truck rendering contract was found for this lane
- safe approval should therefore require the logo to remain legible on a dark background and not rely on white-only marks without outline/contrast support

## 8. Pre-apply smoke results

Observed on `2026-06-22`:

| Route | Result | Notes |
| --- | --- | --- |
| `https://www.mealscout.us/scout` | `200` | route shell loads |
| `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `200` | route shell loads |
| `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb` | `200` | route shell loads |
| public profile API | `200` | live DTO confirms missing logo and honest empty schedule/menu state |

Current logo/placeholder behavior:

- live API exposes no `logoUrl`
- repo rendering path therefore resolves to fallback behavior:
  - public profile hero avatar falls back to initials
  - Scout card falls back to non-image placeholder behavior when no image source is present

Broken image/resource behavior:

- no broken logo resource was observed because no live logo URL exists
- the owned site source itself is currently unavailable, which blocks exact artifact pinning

Mobile status:

- direct live mobile visual confirmation was not feasible in this headless pass
- repo code indicates compact image handling via `object-cover` and fixed card/avatar sizes

Bad CTA/profile crash check:

- no route-level crash was observed from the status checks above
- live API still returns a clean `200` payload for the profile id

## 9. Why this lane is HOLD

This lane must stop because production mutation would be required, and the required mutation prerequisites are still incomplete.

Blocking reasons:

1. no explicit owner-confirmed or Knight-confirmed approval of the exact logo artifact was found in repo evidence
2. the exact owned-site logo file could not be safely captured on `2026-06-22` because the site currently returns `Not available`
3. without the exact artifact, this lane cannot verify:
   - actual file type
   - actual file size
   - actual pixel dimensions
   - actual dark-background legibility
   - actual crop safety in Scout card and truck hero slots

Because production data mutation would be required to set `restaurants.logoUrl`, the lane must stop here.

## 10. Approval-ready apply packet

### Required approval package before apply

Provide all of the following:

- explicit owner approval or strong Knight owner-style approval
- exact logo artifact file
- artifact file name
- artifact file type
- artifact file size
- artifact pixel dimensions
- confirmation that this artifact is approved specifically for public MealScout profile use

### Exact future mutation target

- restaurant/profile id: `75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- target field: `restaurants.logoUrl`
- allowed lane scope: logo only

### Required dry-run/apply sequence

1. build a one-truck manual intake packet for `CREATIVBOWLS`
2. attach the approved file as `logoImage`
3. run dry run first through `POST /api/admin/profile-evidence/apply`
4. confirm:
   - exact restaurant match
   - `logoStatus` is safe
   - no unrelated field mutation is proposed
   - no review/conflict result blocks the lane
5. only then consider apply mode with explicit production approval

### Rollback plan

If a future apply is approved and executed:

1. record the pre-apply live public profile API payload
2. record the pre-apply `logoUrl` value, which is currently blank
3. if the new logo breaks rendering, restore the field to blank/null through the existing safe admin path or direct admin correction path already in the repo
4. verify hero/avatar fallback is restored on both public routes

### Required smoke checklist for the future apply lane

Before apply:

- `/scout`
- canonical CREATIVBOWLS truck route
- alias route
- public profile API

After apply:

- `/scout`
- canonical CREATIVBOWLS truck route
- alias route
- public profile API

Required assertions:

- logo appears where expected
- no broken image
- no public profile crash
- no Scout card layout break
- no menu change
- no schedule change
- no social change
- no profile copy change
- no location or geocode change
- no unrelated truck changed

## 11. Scope confirmation

- No production data was changed.
- No runtime code was changed.
- No schema was changed.
- No cover image was applied.
- No menu was applied.
- No schedule was applied.
- No socials were applied.
- No profile copy was applied.
- No location or address was changed.
- No geocode was applied.
- No map/live-feed behavior changed.
- No B2/internal intake changed.
- No admin claiming changed.
- No import tooling changed.
