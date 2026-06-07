# 3D Eats & Tea Evidence Assets

Status: `IMAGE_REFERENCES_CAPTURED`

GitHub tracker: issue `#113`

## Important limitation

The images were supplied directly in the ChatGPT conversation. This artifact records the image evidence and extraction handling. The raw binary image files still need to be committed by a local shell/Codex session that has access to the uploaded files, or re-uploaded through the repository/UI asset flow.

## Source image references from conversation

| Evidence | Conversation file id | Container path seen by ChatGPT | Captured use |
|---|---|---|---|
| Details/contact screenshot | `file_000000001b6471f5a7d9e2525b6af366` | `/mnt/data/ae8d5163-7ae3-4209-82e6-34c745024b4f.png` | Contact, socials, review count, services, location text |
| Menu screenshot / front-side image | `file_00000000c158722f9fd45fd2b21fc570` | `/mnt/data/64d94199-31d1-409e-a235-1e47cff56d3b.png` | Hot dogs, Chicago section, sides, beverages, kids meals, desserts, hours/address/socials/logo mark |
| Menu screenshot / reverse-side image | `file_00000000ef3071f5a24f50cd94b9d33c` | `/mnt/data/55f312e0-5e30-49e4-8ad2-4a94deecec90.png` | Starters, signature fries, melts, cheesesteaks, burgers, sandwiches |
| Duplicate/menu evidence image | `file_00000000f51871f59b9a35271b71646a` | `/mnt/data/fa37b17e-7f80-47c2-8931-6b7c47e4684a.png` | Duplicate/reference copy of menu-side evidence |
| Logo image | `file_0000000051fc71f589536b0cd20e7f06` | `/mnt/data/31b28e7d-76dd-481d-9986-e0b99645e4bc.png` | Candidate profile logo |

## Desired repo asset paths

When the local shell/Codex session has the files, commit them here:

```text
artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-front.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-back.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-duplicate-reference.png
artifacts/mealscout-onboarding/3d-eats-and-tea/images/logo.png
```

## Local/Codex copy command

Run from the environment where those `/mnt/data/...` paths exist:

```bash
mkdir -p artifacts/mealscout-onboarding/3d-eats-and-tea/images
cp /mnt/data/ae8d5163-7ae3-4209-82e6-34c745024b4f.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/details-contact.png
cp /mnt/data/64d94199-31d1-409e-a235-1e47cff56d3b.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-front.png
cp /mnt/data/55f312e0-5e30-49e4-8ad2-4a94deecec90.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-back.png
cp /mnt/data/fa37b17e-7f80-47c2-8931-6b7c47e4684a.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/menu-duplicate-reference.png
cp /mnt/data/31b28e7d-76dd-481d-9986-e0b99645e4bc.png artifacts/mealscout-onboarding/3d-eats-and-tea/images/logo.png
git add artifacts/mealscout-onboarding/3d-eats-and-tea/images
git commit -m "docs: add 3d eats evidence images"
git push origin main
```

## Apply rule reminder

Do not publish or overwrite existing 3D Eats & Tea account data from these assets automatically. Use append-only enrichment, fill blanks only, and queue conflicts for review.
