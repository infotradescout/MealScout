# 3D Eats & Tea Evidence Assets

Status: `ADMIN_VERIFIED_LOGO_CAPTURED`

GitHub tracker: issue `#113`

Restaurant cover upload-equivalent record:

```text
restaurant_id: 95c4e656-f3cc-46ab-ae18-53f549cecfd1
owner_user_id / uploaded_by_user_id: 58ee83b9-b95c-42dc-95a4-7a285112d7f7
image_upload_id: 5f663d13-88d5-41ca-9021-97873c591732
image_type: restaurant_cover
entity_type: restaurant
public_url: /business-assets/3d-eats-and-tea/cover-photo.png
storage_mode: local_public_asset_cloudinary_unconfigured
```

## Current authority and logo source

Thomas, the MealScout admin who created and managed the 3D Eats profile, has
verified the business and approved its menu and official website logo. The
decision is recorded in
`docs/evidence/3d-eats-admin-verification-2026-07-26.json`.

The approved logo was retrieved from `https://3deats.us/` and is now captured
at:

```text
artifacts/mealscout-onboarding/3d-eats-and-tea/images/logo.jpg
client/public/business-assets/3d-eats-and-tea/logo.jpg
sha256: f1791c958039b2b7437b86824295baf59f0bb123241a0c83cd388bcdc4fd9692
dimensions: 2560x1793
public_url: https://mealscout.onrender.com/business-assets/3d-eats-and-tea/logo.jpg
```

The remaining conversation-supplied menu images are historical evidence
references. The structured, hashed 74-item menu evidence is sufficient for the
guarded apply and does not require those raw screenshots to be republished.

## Source image references from conversation

| Evidence | Conversation file id | Container path seen by ChatGPT | Captured use |
|---|---|---|---|
| Details/contact screenshot | `file_000000001b6471f5a7d9e2525b6af366` | `/mnt/data/ae8d5163-7ae3-4209-82e6-34c745024b4f.png` | Contact, socials, review count, services, location text |
| Menu screenshot / front-side image | `file_00000000c158722f9fd45fd2b21fc570` | `/mnt/data/64d94199-31d1-409e-a235-1e47cff56d3b.png` | Hot dogs, Chicago section, sides, beverages, kids meals, desserts, hours/address/socials/logo mark |
| Menu screenshot / reverse-side image | `file_00000000ef3071f5a24f50cd94b9d33c` | `/mnt/data/55f312e0-5e30-49e4-8ad2-4a94deecec90.png` | Starters, signature fries, melts, cheesesteaks, burgers, sandwiches |
| Duplicate/menu evidence image | `file_00000000f51871f59b9a35271b71646a` | `/mnt/data/fa37b17e-7f80-47c2-8931-6b7c47e4684a.png` | Duplicate/reference copy of menu-side evidence |
| Logo image | `file_0000000051fc71f589536b0cd20e7f06` | `/mnt/data/31b28e7d-76dd-481d-9986-e0b99645e4bc.png` | Candidate profile logo |
| Cover photo | Chat follow-up screenshot | `C:\Users\flavo\Pictures\Screenshots\Screenshot 2026-06-07 104015.png` | Candidate public cover photo showing the wrapped 3-D Eats truck |
| Details/contact screenshot local copy | Local screenshot | `C:\Users\flavo\Pictures\Screenshots\Screenshot 2026-06-07 100636.png` | Contact, socials, review count, services, location text |

## Desired repo asset paths

When the local shell/Codex session has the files, commit them here:

```text
artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-front.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-back.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-duplicate-reference.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/logo.jpg
artifacts/mealscout-onboarding/3d-eats-and-tea/images/cover-photo.png
```

Captured locally in this repo:

```text
artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/cover-photo.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/logo.jpg
client/public/business-assets/3d-eats-and-tea/cover-photo.png
client/public/business-assets/3d-eats-and-tea/logo.jpg
```

The cover photo has a public app path and an `image_uploads` row matching the normal restaurant cover upload shape:

```text
/business-assets/3d-eats-and-tea/cover-photo.png
image_uploads.id = 5f663d13-88d5-41ca-9021-97873c591732
```

Historical source binaries still unavailable locally:

```text
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-front.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-back.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-duplicate-reference.png
```

## Local/Codex copy command

Run from the environment where those `/mnt/data/...` paths exist:

```bash
mkdir -p artifacts/mealscout-onboarding/3d-eats-and-tea/images
cp /mnt/data/ae8d5163-7ae3-4209-82e6-34c745024b4f.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png
cp /mnt/data/64d94199-31d1-409e-a235-1e47cff56d3b.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-front.png
cp /mnt/data/55f312e0-5e30-49e4-8ad2-4a94deecec90.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-back.png
cp /mnt/data/fa37b17e-7f80-47c2-8931-6b7c47e4684a.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-duplicate-reference.png
git add artifacts/mealscout-onboarding/3d-eats-and-tea/images
git commit -m "docs: add 3d eats evidence images"
git push origin main
```

## Apply rule reminder

Use the recorded admin-verification decision and guarded apply script. Preserve
existing account/menu/item identifiers, fill the logo only if blank, add only
the 74 approved menu rows, and never infer a current stop from these assets.
