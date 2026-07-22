# Manual profile asset intake

This lane makes operator-supplied image files enter MealScout through the same admin evidence route and canonical evidence shape as browser uploads. It is append-only, bound to an existing profile ID, owner-aware, and private by default.

## Prepare the private drop

Create this ignored directory inside the repository:

```text
artifacts/manual-intake/mealscout/<profile-slug>/
  manifest.json
  incoming/
    candidate-logo.png
    menu-front.png
```

Use [the example manifest](./MANUAL_PROFILE_ASSET_MANIFEST.example.json) as the starting point. `existingProfileId` is required. Include `ownerUserId` when ownership is known so the server can reject a mismatched profile. Filenames must be plain names, binaries must be PNG, JPEG, WebP, or GIF, and each file must be at most 5 MB.

Never commit the drop. Both incoming files and generated normalized packages are ignored by Git.

## Normalize and inspect

```powershell
npm run intake:manual-assets -- --manifest artifacts/manual-intake/mealscout/<profile-slug>/manifest.json
```

Normalization preflights every file before writing anything, verifies the image signature and extension, computes SHA-256, refuses conflicting overwrites, and writes:

```text
normalized/
  <normalized image files>
  evidence-manifest.json
  profile-evidence-payload.json
```

Each evidence record carries source, original and normalized filename/path, checksum, asset type, profile slug and ID, owner ID, intake timestamp, append-only mode, MIME type, size, and review status.

## Submit through the normal admin path

Start with a dry run against a local or staging server:

```powershell
npm run intake:manual-assets -- --manifest <manifest-path> --submit-dry-run --base-url http://127.0.0.1:5000 --email <admin-email> --password <admin-password>
```

Apply only after reviewing the dry-run response:

```powershell
npm run intake:manual-assets -- --manifest <manifest-path> --submit-apply --base-url <staging-url> --email <admin-email> --password <admin-password>
```

The default apply uploads evidence privately and queues review. A logo candidate is treated as profile evidence, not as the public logo. These independent flags require an explicit operator decision:

- `--approve-logo` makes the logo candidate the public logo and permits replacing an existing logo.
- `--approve-menu-overwrite` permits replacement of existing structured menu rows.
- `--approve-evidence-publication` marks uploaded gallery evidence public.
- `--allow-production` is additionally required to target the known production hosts.

The server resolves only the exact existing profile ID supplied by the package, fails if it does not exist, and returns a conflict when `ownerUserId` does not match. Successful uploads use the existing `/api/admin/profile-evidence/apply` route, Cloudinary storage, and `imageUploads` rows; no duplicate profile is created.

## Verify the contract

```powershell
npm run test:manual-asset-intake
```

The contract covers canonical shape parity, review-gated defaults, exact upload field mapping, idempotent normalization, overwrite refusal, missing-binary failure, traversal rejection, and route guardrails.
