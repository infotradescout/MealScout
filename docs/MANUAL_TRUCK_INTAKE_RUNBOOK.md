# MealScout Manual Truck Intake Runbook (P1)

## Scope

This runbook covers manual operator onboarding for truck profile intake and menu evidence repair.

It does **not** include:

- payment setup
- payout setup
- Stripe configuration
- affiliate expansion

## Required Inputs

For each truck, provide as many of these as possible:

- Business profile basics
  - truck/business name
  - address/city/state
  - phone/email
  - website/social links
  - operator notes
- Logo image
  - upload as `logoImage`
- Profile/truck media images
  - upload as `profileImages`
- Menu screenshots
  - upload as `menuImages`
- Hours/schedule screenshots
  - upload as `hoursImages`
- Contact/admin evidence screenshots
  - upload as `contactImages`

## Where Files Go

On apply mode, files are uploaded through the same storage shape used by user uploads:

- `image_uploads` rows with:
  - `uploadedByUserId`
  - `entityType = restaurant`
  - `entityId = matched restaurant id`
  - cloudinary metadata and dimensions
- profile media -> `imageType = restaurant_gallery_truck`
- menu evidence -> `imageType = restaurant_gallery_menu`
- hours evidence -> `imageType = restaurant_gallery_hours`
- contact/admin evidence -> `imageType = restaurant_gallery_contact`
- logo -> `imageType = restaurant_logo`

Media entries are also appended into restaurant `socialAutopostSettings.publicGalleryImages`.

## Preview/Dry-Run Workflow

Endpoint: `POST /api/admin/profile-evidence/apply`

- Default mode is dry run (`mode = dry_run`).
- Dry run returns:
  - match classification and reasons
  - fields that would be applied or skipped
  - conflict list
  - menu/schedule/logo/evidence status
  - review queue candidates
- Dry run does not mutate profile/menu rows.

## Apply Approval Workflow

Use `mode = apply` only after reviewing dry-run output.

Apply mode performs safe mutation rules:

- fill blank profile fields only
- keep existing non-blank values unchanged
- surface differences in `conflicts`
- write review queue items for conflict cases and low-confidence menu evidence

### Explicit Overwrite Approvals

Approvals must be passed explicitly:

```json
"approvals": {
  "menuOverwrite": false,
  "logoOverwrite": false
}
```

- `menuOverwrite = true` is required before replacing an existing menu.
- `logoOverwrite = true` is required before replacing an existing logo.

Without these approvals, existing menu/logo values are preserved and queued for review.

## Never Auto-Overwrite Rules

The intake path does not auto-overwrite these areas without explicit approval/review:

- existing menu data
- existing logo/media when replacement is not approved
- non-blank profile values that conflict with incoming values

Conflicts are surfaced and queued for review, not silently applied.

## Review Queue Signals

The system queues review items for:

- menu evidence with low-confidence extraction
- menu screenshots without parsed menu items
- existing menu conflicts
- existing logo conflicts
- hours evidence requiring confirmation
- contact/admin evidence requiring confirmation
- field-level profile conflicts

## Operator Checklist

1. Build payload with `match` and `fillIfBlank` data.
2. Attach evidence files in categorized fields (`logoImage`, `profileImages`, `menuImages`, `hoursImages`, `contactImages`).
3. Run dry run first and inspect:
   - `fieldsApplied`
   - `fieldsSkipped`
   - `conflicts`
   - `reviewQueueItems`
4. If needed, set explicit approvals (`menuOverwrite`, `logoOverwrite`) after human review.
5. Run apply and verify returned evidence upload counts and statuses.
6. Open matched restaurant profile to verify linked media/evidence.

## Real Smoke Packet

Use one real truck packet and run the smoke with real image evidence files.

### Exact File Categories

- `logoImage`: one logo image
- `profileImages`: one or more truck/profile images
- `menuImages`: one or more menu screenshots
- `hoursImages`: one or more hours/schedule screenshots
- `contactImages`: one or more contact/social/admin screenshots

Include operator notes in payload `sourceNotes`.

### Smoke Runner

Script: `scripts/runManualTruckIntakeSmokePacket.ts`

Example command (dry run only, default):

```bash
node --import tsx scripts/runManualTruckIntakeSmokePacket.ts \
  --packet artifacts/mealscout-onboarding/3d-eats-and-tea/profile-enrichment.json \
  --logo artifacts/mealscout-onboarding/3d-eats-and-tea/images/cover-photo.png \
  --profile-images artifacts/mealscout-onboarding/3d-eats-and-tea/images/cover-photo.png \
  --menu-images artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png \
  --hours-images artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png \
  --contact-images artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png
```

Optional apply execution:

- `--apply` enables apply mode
- `--menu-overwrite` enables explicit menu replacement approval
- `--logo-overwrite` enables explicit logo replacement approval
- `--allow-production` must be passed to target `*.mealscout.us`

### Expected Preview Result

Preview (dry run) should return:

- `status = dry_run`
- `evidenceStatus` present
- `menuEvidenceStatus` present
- `uploadedEvidence` array present
- `reviewQueueItems` array present when conflicts/menu evidence review are needed
- existing menu/logo preserved (no silent overwrite)

### Expected Apply Result

Apply should return:

- `status = applied`
- `evidenceStatus` and `menuEvidenceStatus` present
- `uploadedEvidence` count populated when files were attached
- `reviewQueueItems` populated when review is required

Apply without overwrite approvals must preserve existing menu/logo:

- existing menu is not replaced unless `approvals.menuOverwrite = true`
- existing logo is not replaced unless `approvals.logoOverwrite = true`

### Failure States

- missing required file category input
- login/session failure
- invalid payload JSON
- low-confidence or missing menu extraction resulting in queued review
- ambiguous identity match (`needs_review`)
- upload service not configured

### Rollback/No-Overwrite Rules

- Always execute dry run first.
- Do not apply overwrite approvals unless explicitly reviewed.
- If conflicts are surfaced, keep approvals disabled and resolve via review queue.
- If apply was run unintentionally, do not run second apply with overwrite approvals.
- Never perform production apply without explicit approval and `--allow-production`.

## Validation Commands

- `npm run check`
- `npm run test -- profile-evidence-apply.contract`
- `npm run test -- manual-truck-intake-evidence.contract`
