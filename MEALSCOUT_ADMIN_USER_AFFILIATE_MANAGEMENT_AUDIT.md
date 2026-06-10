# MealScout Admin User Affiliate Management Audit

Status: `C5B Fold Affiliate Management Into Admin User Card`

Affiliate management belongs inside the admin user card. This audit records the current code truth and the correction; it does not create a new affiliate system, payout model, attribution model, or role model.

Doctrine note: Affiliate is not a standalone user role. Affiliate sharing is an attribution/campaign capability that can exist across user authorities when share/tag state exists. Role authority controls permissions; affiliate state controls attribution tools.

## Current Code Says This

- `server/roleAccess.ts` treats `admin`, `duper_admin`, and `super_admin` as internal admin-family user types.
- `server/roleAccess.ts` does not assign public affiliate tags to admin-family user types by default.
- `client/src/pages/admin-dashboard.tsx` is the admin operator surface for user identity, role/user type, email verification, affiliate link display, affiliate status, supported affiliate settings, and attached business/entity actions.
- `client/src/pages/AdminAffiliateManagement.tsx` remains an aggregate affiliate reporting/overview surface, not the required place to manage one selected user.
- `server/routes/admin/affiliateAdminRoutes.ts` supports admin edits to existing affiliate settings such as percentage/referrer relationships (`affiliatePercent`, `affiliateCloserUserId`, `affiliateBookerUserId`), but it does not expose an admin endpoint to create, regenerate, remove, or disable a user affiliate tag.
- Public affiliate attribution uses direct clean links `/<safe-internal-path>?ref=<affiliateTag>` for generated shares; legacy `/ref/...` remains redirect-only compatibility.

## Current UI Showed This

- The user detail area had a primary affiliate link section, but single-user affiliate settings were still only editable from the separate affiliate page.
- The same card previously had a button that copied an internal admin focus URL: `/admin/dashboard?tab=users&focusUser=<userId>`.
- Internal admin users previously could still reach affiliate link display if an affiliate tag was present.

## This Is Wrong Because Of This Product Rule

- Admins manage affiliate visibility and supported affiliate settings.
- Internal admin-family accounts do not receive public-ref affiliate assignment or payout controls by default.
- The public affiliate/profile link is for outside-world sharing.
- The admin focus URL is for internal operator navigation.
- Those must never be the same primary button, and the admin focus URL should not be copied from the user card at all.
- A separate affiliate page can remain for aggregate reporting, payout review, and bulk oversight, but it must not be required for normal single-user affiliate management.

## Correction

- The admin user card includes an `Affiliate Management` section.
- The primary user-facing link label remains `Affiliate Link`.
- The canonical primary affiliate link uses direct attribution: `https://www.mealscout.us/<public-profile-path>?ref=<affiliateTag>`.
- `Copy Link` and `Open Link` use direct public profile links with clean `ref`, not `/admin/dashboard`.
- Public truck, restaurant, or location profile URLs are shared directly with `ref` attribution.
- For eligible users without a tag, the card shows `No affiliate link assigned`.
- For internal admin-family accounts, the card shows `Not applicable for internal admin accounts.` and hides public `Copy Link` / `Open Link` controls.
- The internal admin focus URL is not copied from the user card.
- The card mirrors only backend-supported single-user settings: `affiliatePercent`, `affiliateCloserUserId`, and `affiliateBookerUserId`.
- The raw affiliate token is secondary internal metadata only, shown as `Internal token`.
- No `Create Link`, `Regenerate Link`, `Remove Affiliate`, or `Disable Affiliate` control is added because the current backend does not support those tag actions for arbitrary admin-selected users.

## Test Guarding It

- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies the primary affiliate URL is the universal referral wrapper: `https://www.mealscout.us/ref/<affiliateTag>?to=<public-profile-path>`.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies `Copy Link` and `Open Link` operate on the public affiliate link, not `/admin/dashboard`.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies `Copy Admin Link` is absent.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies supported single-user affiliate settings are in the admin user card.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies the aggregate affiliate page may remain as reporting/overview.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies internal admin-family users get the not-applicable copy and no affiliate controls.
- `scripts/mealscout-admin-user-affiliate-management.contract.test.ts` verifies no payout logic, attribution mutation, role redesign, or fake tag controls were added.

## Preserved Admin Truth

- Customer users do not show `invalid_missing_business`.
- Customer users do not show business-only controls.
- Existing code-supported `userType` values remain unchanged.
- Parking Pass free-management access remains unchanged.
