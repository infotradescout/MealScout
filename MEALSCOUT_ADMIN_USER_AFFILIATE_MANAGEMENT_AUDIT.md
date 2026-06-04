# MealScout Admin User Affiliate Management Audit

Status: `C5B Admin User Affiliate Link Eligibility Correction`

Affiliate management belongs inside the admin user card. This audit records the current code truth and the correction; it does not create a new affiliate system, payout model, attribution model, or role model.

## Current Code Says This

- `server/roleAccess.ts` treats `admin`, `duper_admin`, and `super_admin` as internal admin-family user types.
- `server/roleAccess.ts` does not assign affiliate tags to admin-family user types.
- `client/src/pages/admin-dashboard.tsx` is the admin operator surface for user identity, role/user type, email verification, affiliate link display, and attached business/entity actions.
- `server/routes/admin/affiliateAdminRoutes.ts` supports admin edits to existing affiliate settings such as percentage/referrer relationships, but it does not expose an admin endpoint to create, regenerate, remove, or disable a user affiliate tag.
- Public affiliate attribution uses the existing MealScout `?ref=<affiliateTag>` format.

## Current UI Showed This

- The user detail area had a primary affiliate section, but the public affiliate URL could fall back only to the homepage referral URL.
- The same card also had a button that copied an internal admin focus URL: `/admin/dashboard?tab=users&focusUser=<userId>`.
- Internal admin users could still reach affiliate link display if an affiliate tag was present.

## This Is Wrong Because Of This Product Rule

- Admins manage affiliates.
- Admins are not affiliates.
- The public affiliate/profile link is for outside-world sharing.
- The admin focus URL is for internal operator navigation.
- Those must never be the same primary button.

## Correction

- The primary label remains `Affiliate Link`.
- For affiliate-eligible users with an attached public profile, the public link is:
  - `https://www.mealscout.us/p/truck/<profileId>/<slug>?ref=<affiliateTag>`
  - `https://www.mealscout.us/p/restaurant/<profileId>/<slug>?ref=<affiliateTag>`
  - `https://www.mealscout.us/p/location/<profileId>/<slug>?ref=<affiliateTag>`
- For affiliate-eligible users with no attached public profile, the fallback is `https://www.mealscout.us/?ref=<affiliateTag>`.
- For eligible users without a tag, the card shows `No affiliate link assigned`.
- For internal admin-family accounts, the card shows `Not applicable for internal admin accounts.` and hides `Copy Link` / `Open Link`.
- The internal admin focus URL is available only as `Copy Admin Link`.
- No `Create Link`, `Regenerate Link`, `Remove Affiliate`, or `Disable Affiliate` control is added because the current backend does not support those tag actions for arbitrary admin-selected users.

## Test Guarding It

- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies public affiliate URLs are built from existing profile fields and `?ref=`.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies `Copy Link` and `Open Link` operate on the public affiliate link, not `/admin/dashboard`.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies `Copy Admin Link` is separate.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies internal admin-family users get the not-applicable copy and no affiliate controls.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies no payout logic, attribution mutation, role redesign, or fake tag controls were added.

## Preserved Admin Truth

- Customer users do not show `invalid_missing_business`.
- Customer users do not show business-only controls.
- Existing code-supported `userType` values remain unchanged.
- Parking Pass free-management access remains unchanged.
