# MealScout Affiliate Referral Capture Audit

Status: `Production hotfix - Diner signup and affiliate referral public routing`

This audit documents current public referral capture for guest links such as `/scout?ref=<tag>`. It is a production stabilization note, not an affiliate product redesign.

## Production Rule

- `/scout?ref=<tag>` is a valid public route and must not 404 because query params are not route names.
- Guest `?ref=<tag>` values must be captured and preserved through signup/login navigation.
- Guest referral refs must not be cleared merely because `/api/auth/user` returns 401 or `user` is undefined.
- Authenticated non-internal users may still use existing affiliate tag behavior.
- Internal `admin`, `duper_admin`, and `super_admin` accounts must not be affiliate-assigned through a public `ref`.
- `ref` is referral metadata only; it is not role/userType/business/profile email data.
- Protected account endpoints such as `/api/affiliate/tag` and `/api/business-access/me` must wait for confirmed auth; guest referral capture must not pretend those 401s mean a signed-in user.

## Current Code Says

- `server/index.ts` captures affiliate `?ref=` on all non-static requests before SPA/static handlers and writes a `referralId` cookie.
- `client/src/App.tsx` registers `/scout` as a public route.
- `client/src/hooks/useAuth.ts` confirms auth state via `/api/auth/user` and must not erase guest refs during guest state.
- `client/src/lib/share.ts` stores the guest referral key as `affiliate_ref`.
- `client/src/lib/api.ts` gates `/api/affiliate/*` and `/api/business-access/*` as protected account paths.
- `server/unifiedAuth.ts` applies referral attribution from `referralId` and now rejects internal admin user types before assignment.

## Correction

- `client/src/hooks/useAuth.ts` captures URL `ref` into local storage.
- `client/src/hooks/useAuth.ts` no longer calls `setAffiliateRef(null)` merely because `user` is undefined.
- OAuth/session recovery no longer clears the stored guest referral ref when auth confirmation fails.
- `client/src/pages/customer-signup.tsx` preserves the stored/current `ref` when navigating among signup paths and includes it as `referralId` on signup payloads.
- `client/src/pages/login.tsx` preserves the stored/current `ref` through Google/Facebook OAuth URLs.
- `server/unifiedAuth.ts` does not assign referral closer state to internal admin accounts.

## Do-Not-Touch Rules

- Do not add payout logic.
- Do not redesign affiliate attribution.
- Do not create fake affiliate tags.
- Do not add a diner role.
- Do not change OAuth/session behavior except preserving existing ref through public signup/login routing.
- Do not change Parking Pass behavior.
- Do not change setup-token flow.

## Validation

- `node scripts/mealscout-signup-account-type-mapping.contract.test.ts`
- `node scripts/mealscout-affiliate-referral-capture.contract.test.ts`
- `node scripts/mealscout-auth-onboarding-alignment.contract.test.ts`
- `node scripts/mealscout-admin-user-affiliate-management.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`
