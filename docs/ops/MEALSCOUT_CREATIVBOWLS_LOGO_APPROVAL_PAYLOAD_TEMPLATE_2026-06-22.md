Status: `creativbowls logo approval payload template`

# MealScout CREATIVBOWLS Logo Approval Payload Template - 2026-06-22

## 1. Executive decision

This is a docs-only approval-payload template for a future `CREATIVBOWLS` logo-only apply lane.

This packet does not grant approval.

This packet exists to capture the exact evidence that must be present before any later production logo apply can proceed.

Current approval state from merged source material:

- approval granted: `no`
- approved artifact pinned: `no`
- production apply allowed now: `no`

Until those values change with verified source evidence, the correct state remains `HOLD`.

## 2. Source packet used

Primary required source:

- `docs/ops/MEALSCOUT_CREATIVBOWLS_LOGO_ONLY_APPLY_HOLD_2026-06-22.md`

Carried-forward doctrine:

- `docs/ops/MEALSCOUT_PRIORITY_THREE_THIN_PROFILE_TRUST_APPLY_PREP_2026-06-21.md`

## 3. Current known truck identity

Use this section as the fixed identity anchor for the approval payload.

| Field | Current value |
| --- | --- |
| truck name | `CREATIVBOWLS` |
| profile id | `75dd470e-2692-4579-bde0-a64dcc3f6fcb` |
| canonical route | `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb` |
| alias route | `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb` |
| future target field | `restaurants.logoUrl` |
| current production logo state | `missing` |
| current lane state | `HOLD` |

## 4. Approval existence check

Do not change this section to `yes` unless actual owner/Knight approval evidence is attached and cited.

| Field | Current status | Evidence required to change status |
| --- | --- | --- |
| approval exists | `no` | explicit owner-confirmed or Knight owner-style approval |
| exact artifact exists | `no` | exact file or stable source URL pinned |
| artifact approved for MealScout public use | `no` | source evidence explicitly says the logo is approved for public MealScout profile use |
| apply permission | `no` | explicit `yes` for logo-only field scope |

Current missing evidence:

- exact logo file or stable source URL
- explicit owner/Knight approval
- approval date
- explicit `logo only` field authorization
- confirmation that blocked fields remain blocked

## 5. Approval payload template

Fill this section only when actual evidence exists.

```text
Truck: CREATIVBOWLS
Profile id: 75dd470e-2692-4579-bde0-a64dcc3f6fcb
Canonical route: https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb
Alias route: https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb

Exact logo artifact file path: [REQUIRED OR LEAVE BLANK]
Stable source URL: [REQUIRED OR LEAVE BLANK]
Artifact file name: [REQUIRED OR LEAVE BLANK]
Artifact file type: [REQUIRED OR LEAVE BLANK]
Artifact file size: [REQUIRED OR LEAVE BLANK]
Artifact pixel dimensions: [REQUIRED OR LEAVE BLANK]
Artifact checksum/hash: [OPTIONAL IF LOCALLY AVAILABLE]

Approving authority: [OWNER NAME OR KNIGHT NAME]
Approval date: [YYYY-MM-DD]
Approval type: owner-style profile update
Approval evidence source: [SCREENSHOT / EMAIL / PACKET / MESSAGE / DOC LINK]

Allowed field: logo only
Apply permission: yes / no

Blocked fields:
- cover
- menu
- schedule
- socials
- location
- geocode
- profile copy

Duplicate identity confirmation:
- canonical route and alias route resolve to the same profile id
- no second truck account is being created
- no duplicate public profile is being approved
- no competing owner identity is being created or preserved

Rollback requirement:
- record pre-apply live public profile payload
- record pre-apply logoUrl state
- if rendering breaks, restore logoUrl to blank/null through the existing safe admin path

Exact-route smoke checklist before apply:
- /scout
- canonical CREATIVBOWLS route
- alias route
- public profile API

Exact-route smoke checklist after apply:
- /scout
- canonical CREATIVBOWLS route
- alias route
- public profile API
```

## 6. Field-by-field requirements

| Payload field | Required | Current status from source material | Notes |
| --- | --- | --- | --- |
| truck name | yes | known | fixed as `CREATIVBOWLS` |
| profile id | yes | known | fixed as `75dd470e-2692-4579-bde0-a64dcc3f6fcb` |
| canonical route | yes | known | fixed |
| alias route | yes | known | fixed |
| exact logo artifact file path or stable source URL | yes | missing | HOLD packet says exact artifact was not safely pinned |
| artifact checksum/hash | optional | missing | include if file exists locally |
| approving authority | yes | missing | must be owner or Knight |
| approval date | yes | missing | must be explicit |
| approval type | yes | fixed | `owner-style profile update` |
| allowed field | yes | fixed | `logo only` |
| blocked fields | yes | fixed | must remain unchanged |
| duplicate identity confirmation | yes | partially known | routes and profile id are known; confirmation must be preserved in later apply lane |
| rollback requirement | yes | template-ready | must be carried into any future mutation lane |
| exact-route smoke checklist | yes | template-ready | required before and after any future apply |

## 7. Duplicate identity confirmation template

Use this block unchanged unless stronger identity evidence requires an explicit conflict note.

```text
Duplicate identity confirmation:
CREATIVBOWLS must remain one canonical truck profile identity.
The canonical /truck/... route and /p/truck/:id route may both exist only as aliases to the same profile id, not as separate accounts or duplicate public profiles.
This payload does not approve or create a second truck account.
Any future duplicate CREATIVBOWLS record, owner account, or competing public profile must be treated as a blocked identity conflict until owner/Knight evidence confirms merge, redirect, deactivation, or blocked non-match.
```

## 8. Explicit blocked fields

These fields are out of scope for the future logo-only apply lane unless a separate approved packet explicitly changes them:

- `coverImageUrl`
- `menuUrl`
- structured menu rows
- schedule rows
- `instagramUrl`
- `facebookPageUrl`
- `websiteUrl`
- location or address fields
- geocode or map coordinates
- profile description or copy

## 9. Rollback requirement

Any future apply lane using this approval payload must capture:

1. pre-apply public profile API payload
2. pre-apply `logoUrl` value
3. post-apply public profile API payload
4. post-apply route smoke results
5. exact rollback command or admin correction path if the logo breaks rendering

No future apply lane should proceed without a rollback note tied to the exact approved artifact.

## 10. Exact-route smoke checklist

### Before apply

- `https://www.mealscout.us/scout`
- `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- `https://mealscout.onrender.com/api/public/profiles/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`

Before-apply assertions:

- route loads
- current logo state is still missing or matches expected before-state truth
- no broken image placeholder appears
- no unrelated truck identity appears
- canonical and alias routes resolve to the same profile identity

### After apply

- `https://www.mealscout.us/scout`
- `https://www.mealscout.us/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- `https://www.mealscout.us/p/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`
- `https://mealscout.onrender.com/api/public/profiles/truck/75dd470e-2692-4579-bde0-a64dcc3f6fcb`

After-apply assertions:

- logo appears where expected
- no broken image
- no card/profile layout break
- no menu change
- no schedule change
- no social change
- no location/geocode change
- no profile copy change
- no duplicate identity surface appears

## 11. Current decision summary

Current repo-backed answer today:

- whether approval exists: `no`
- whether production data should change now: `no`
- whether the payload template is ready: `yes`

This packet is intentionally a template and not an approval grant.

## 12. Scope confirmation

- No production data changed in this packet.
- No runtime code changed in this packet.
- No schema changed in this packet.
- No logo was applied in this packet.
- No profile content changed in this packet.
- No map/live-feed behavior changed in this packet.
- No B2/internal intake changed in this packet.
- No admin claiming changed in this packet.
- No import tooling changed in this packet.
