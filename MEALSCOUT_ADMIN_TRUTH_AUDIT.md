# MealScout Admin Truth Audit

Status: `C5B Admin Truth Correction`

This audit records current MealScout admin-display truth. It does not design new roles, permissions, products, or features.

## Customer Business Attachment

- Current code says: `customer` is a valid `userType` in `server/roleAccess.ts`, and `shared/schema/legacy.ts` defaults `users.user_type` to `customer`.
- Current UI showed: customer user cards could surface `attachment:invalid_missing_business`.
- This is wrong because: regular customers do not own a restaurant, truck, host location, event coordinator account, or supplier account by default.
- Correction: `client/src/pages/admin-dashboard.tsx` resolves non-business-bearing roles to `not_required` before `invalid_missing_business`, and attachment badges are gated behind business-bearing roles.
- Test guarding it: `scripts/mealscout-admin-truth-correction.contract.test.ts` checks customer/non-business roles resolve before `invalid_missing_business` and that attachment badges are business-role gated.

## Customer Business-Only Controls

- Current code says: business repair controls are admin repair actions for business-bearing accounts.
- Current UI showed: business-only affordances could be mixed into normal user cards without enough role clarity.
- This is wrong because: customers should not see attach-business, create-business-shell, or monthly subscription-link controls unless the action is explicitly valid for customers.
- Correction: attach/create controls remain gated by restaurant/truck business roles; `Send Monthly Link` is rendered only for canonical monthly subscription roles.
- Test guarding it: `scripts/mealscout-admin-truth-correction.contract.test.ts` checks attach/create and subscription controls are role-gated and not customer-primary controls.

## Affiliate Link Display

- Current code says: affiliate/referral attribution uses an internal `affiliateTag` and the app-supported `?ref=` URL format.
- Current UI showed: `Affiliate Tag` with a raw token such as `user8530`.
- This is wrong because: admins/operators need the usable sharing asset, not the internal token.
- Correction: admin user detail displays `Affiliate Link`, renders `https://www.mealscout.us/?ref=<tag>`, and provides `Copy Link` and `Open Link`.
- Test guarding it: `scripts/mealscout-admin-truth-correction.contract.test.ts` checks the label, full URL construction, copy/open controls, and empty state for users without a tag.

## Role Dropdown Truth

- Current code says: canonical assignable user types are defined in `server/roleAccess.ts`: `customer`, `restaurant_owner`, `food_truck`, `supplier`, `host`, `event_coordinator`, `staff`, `admin`, `duper_admin`, and `super_admin`.
- Current UI showed: role labels could use non-canonical wording such as generic `Business Owner`, and supported roles could drift from dropdown options.
- This is wrong because: admin role assignment must use existing code-supported `userType` values only.
- Correction: admin role dropdowns use only canonical code-supported values, with product-lane labels like `Restaurant Owner`, `Food Truck`, `Supplier`, and `Event Coordinator`.
- Test guarding it: `scripts/mealscout-admin-truth-correction.contract.test.ts` compares dropdown options against existing supported values and forbids invented role values/labels.

## Parking Pass Free Management Boundary

- Current code says: Parking Pass has its own page and route gates for booking, host management, insurance, and role-specific actions.
- Current UI/auth behavior risk: unrelated business onboarding or paid business-feature gates can accidentally block `/parking-pass` access.
- This is wrong because: Parking Pass management access must remain free/no-cost where already intended, and paid deal/analytics/social gates must not be reused as broad Parking Pass gates.
- Correction: `client/src/hooks/useAuth.ts` no longer globally redirects `/parking-pass` through unrelated business onboarding setup.
- Test guarding it: `scripts/mealscout-admin-truth-correction.contract.test.ts` checks `/parking-pass` is absent from the unrelated business-onboarding redirect block and documents the free-management rule.

## Scope Guard

- No new roles were introduced.
- No product features were introduced.
- No payout, attribution, subscription, or booking mutation model was redesigned.
- This slice corrects admin truth display only.
