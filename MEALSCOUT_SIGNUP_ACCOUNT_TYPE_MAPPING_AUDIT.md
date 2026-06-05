# MealScout Signup Account Type Mapping Audit

Status: `Production hotfix - Customer signup label and affiliate referral public routing`

This audit documents current signup account-type mapping for the Customer path and legacy `role=diner` alias. It is not a role redesign, not a new signup product surface, and not a new affiliate system.

## Production Rule

- `Customer` is the user-facing signup label in `client/src/pages/customer-signup.tsx`.
- `diner` in `/customer-signup?role=diner` is a legacy alias that maps to the existing `customer` registration behavior.
- No `diner` database role or `userType` is introduced.
- `ref` is referral metadata only; it is not a role, `userType`, business identity, profile email, or verification state.
- `/customer-signup?role=diner` is a public, guest-safe route and must not require prior auth.
- `/customer-signup?role=diner` must enter the normal customer signup form instead of staying on the account-type chooser.
- Clicking the `Customer` card must mark the signup flow selected locally, because the route may remain on the same mounted page while only query parameters change.
- Customer UI selection is normalized through the legacy `diner` flow key before chooser/form gating and still submits the canonical existing `customer` account type to `/api/auth/customer/register`.
- Unauthenticated `/api/auth/user` returning 401 on signup pages is guest-safe and non-fatal.

## Current Code Says

- `client/src/pages/customer-signup.tsx` lists a signup card with label `Customer` and legacy `href: "/customer-signup?role=diner"`.
- `client/src/pages/customer-signup.tsx` uses `AccountType = "diner" | "host" | "event_organizer" | "business" | "supplier"`.
- `client/src/pages/customer-signup.tsx` normalizes `role=diner` and `role=customer` to the UI-only `diner` account type before form gating.
- `client/src/pages/customer-signup.tsx` uses local `signupFlowSelected` state so choosing Customer advances into the form even when the current route component is already mounted.
- `client/src/pages/customer-signup.tsx` maps non-host, non-event, non-business signup to `customer` through `getRegistrationUserType`.
- `client/src/pages/customer-signup.tsx` keeps referral metadata on the selected signup path and on the in-form `Change` path.
- `client/src/App.tsx` registers `/customer-signup` as a route in both guest and authenticated route sets.
- `server/unifiedAuth.ts` handles `/api/auth/customer/register` using existing customer registration behavior.
- `server/emailService.ts` displays the canonical `customer` user type as `Customer`.

## Correction

- Display `Customer` as the label and keep `diner` only as the UI flow key / legacy URL alias.
- Normalize incoming `role` values before any chooser/form gating.
- Treat Customer card selection as a selected flow immediately, not as an unsupported role that waits for a remount.
- Continue sending `accountType: "customer"` to `/api/auth/customer/register` for diner signup.
- Preserve `ref` during signup path selection by appending it to selected signup-flow URLs when present.
- Preserve `ref` when moving from the selected signup form back to the account-type chooser.
- Include the existing `referralId` input on signup payloads so server-side referral capture can use the same referral identifier if the cookie is missing.

## Do-Not-Touch Rules

- Do not add a `diner` role.
- Do not rename `customer`.
- Do not change role permissions.
- Do not change Parking Pass access.
- Do not change setup-token flow.
- Do not add payout logic.
- Do not add fake affiliate tags.
- Do not treat `ref` as role/userType/business/profile/email data.

## Validation

- `node scripts/mealscout-signup-account-type-mapping.contract.test.ts`
- `node scripts/mealscout-affiliate-referral-capture.contract.test.ts`
- `node scripts/mealscout-auth-onboarding-alignment.contract.test.ts`
- `node scripts/mealscout-admin-user-affiliate-management.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`
