# MealScout Auth + Onboarding Alignment Audit

Status: `C5D Account Creation + Login + Onboarding Alignment Audit`

This audit documents the current MealScout account lifecycle from entry source to continuation route. It is a production stabilization audit, not a new auth model, role model, payment model, or onboarding feature plan.

## Production Rule

- One account lifecycle must resolve who the user is, whether they are authenticated, what setup state they are in, what `userType` they have, which verification state applies, and where they go next.
- Email verification, business/profile verification, insurance verification, and claim verification are separate checks.
- Customer accounts do not require business attachment.
- Host Parking Pass management must remain free from unrelated paid business gates where the current product intends free management access.
- OAuth success query params are hints only; `/api/auth/user` is the only confirmed signed-in state.
- Code-supported roles only: `customer`, `restaurant_owner`, `food_truck`, `host`, `event_coordinator`, `supplier`, `staff`, `admin`, `duper_admin`, `super_admin`, plus existing legacy/unknown handling where code already supports it.

## Entry Source Matrix

| Entry source | Frontend route | Backend route/service | Expected auth state | Expected setup state | Expected verification state | Expected continuation route | Known failure mode | Test coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Email/password login | `client/src/pages/login.tsx` | `server/routes/authAccountRoutes.ts`, `server/unifiedAuth.ts`, `server/services/loginContinuation.ts` | Authenticated via session after login | Existing profile fields and `mustResetPassword` determine account onboarding | Email verification remains separate from business/insurance checks | `continuationPath` from login continuation or role dashboard fallback | Wrong role or incomplete account can land on a dashboard without setup context | `scripts/mealscout-auth-onboarding-alignment.contract.test.ts` |
| Google login | `client/src/pages/login.tsx`, `client/src/pages/restaurant-signup.tsx` | `server/unifiedAuth.ts` Google customer/restaurant OAuth routes | Authenticated after callback/session save | OAuth users must not be sent to setup-token validation unless a setup token exists | OAuth provider identity is not business or insurance verification | `resolveOAuthContinuationPath(user)` or safe redirect, sanitized away from bare `/account-setup` | OAuth redirect can trap a user on `/account-setup` without a token | `scripts/mealscout-auth-onboarding-alignment.contract.test.ts` |
| Facebook login | `client/src/pages/login.tsx` | `server/unifiedAuth.ts` Facebook OAuth route/callback | Authenticated after callback/session save | OAuth-created users use existing captured `oauthUserType`/safe redirect state | OAuth provider identity is not business or insurance verification | `resolveOAuthContinuationPath(user)` or safe redirect, sanitized away from bare `/account-setup` | User can land on `/account-setup` and see setup-link/account-handoff UI after normal login | `scripts/mealscout-auth-onboarding-alignment.contract.test.ts` |
| Customer signup | `client/src/pages/customer-signup.tsx` | `server/unifiedAuth.ts`, account routes | Account created; login may require email verification | Customer profile fields drive basic account completion only | Email verification only; no business attachment required | `/post-verification` then Scout/user route after login continuation | Customer treated like business-bearing user | `scripts/mealscout-admin-truth-correction.contract.test.ts` plus C5D contract |
| Restaurant signup | `client/src/pages/restaurant-signup.tsx` | `server/routes/restaurantSignupRoutes.ts` | Authenticated or signup-created depending source | Business profile/setup may remain incomplete | Business/profile verification and insurance are separate from email verification | Restaurant owner dashboard/setup route | Deal/payment/verification state can be conflated with account creation | C5D contract and existing business verification contracts |
| Claim truck | `client/src/pages/claim-truck.tsx` | `server/routes/truckClaimRoutes.ts`, `server/routes/claimRoutes.ts` | Authenticated user or claim-created/linked user | Food truck owner/truck setup continues after claim | Claim verification, email verification, business verification, and insurance are separate | Truck/owner dashboard or claim/setup continuation | Claim intent lost across auth/OAuth | C5D contract plus claim-flow contracts |
| Account setup invite | `client/src/pages/account-setup.tsx` | `server/utils/accountSetup.ts`, `server/unifiedAuth.ts` setup-token endpoints | Not necessarily authenticated before setup | Valid token opens setup form; missing/invalid/expired/used token shows clear failure/escape state | Completing profile does not replace business/insurance checks | `/post-verification` after completion | Missing token previously showed endless `Validating setup link...` | C5D contract |
| Owner verification link | `client/src/pages/post-verification.tsx`, owner/signup surfaces | `server/routes/authAccountRoutes.ts`, verification routes | User verifies email or checks status, then logs in/continues | Setup state resolved by login continuation | Email verification is separate from business and insurance verification | Redirect stored in `mealscout:post-verification-redirect` or continuation fallback | Verification steps collapsed into one ambiguous state | C5D contract |
| Admin-created user | `client/src/pages/admin-dashboard.tsx` | `server/routes/admin/*`, `server/utils/accountSetup.ts` | Invited user completes setup through token | Link must validate to setup form; used/expired/invalid states must be clear | Admin setup does not auto-satisfy business/insurance verification | `/account-setup?token=...` then `/post-verification`/continuation | Used/expired token produces confusing blank/spinner | C5D contract |
| Mobile/Capacitor web session | `client/src/App.tsx`, `client/src/hooks/useAuth.ts` | Same auth/session endpoints | Session refresh must resolve current user | Auth refresh/OAuth redirect handling must not loop into setup token validation | Same verification separation as web | Role-aware continuation or current route if safe | Mobile refresh can preserve stale OAuth/setup route | C5D contract |

## Role/UserType Continuation

- `customer`: Scout/customer route or user dashboard; no business attachment requirement.
- `restaurant_owner`: owner dashboard or restaurant setup when business/profile link is missing.
- `food_truck`: owner/truck dashboard, menu builder, schedule/Parking Pass management, or setup path based on continuation state.
- `host`: host dashboard / Parking Pass host tools where existing routes allow it.
- `event_coordinator`: event coordinator dashboard.
- `supplier`: supplier dashboard/routes where existing code routes supplier users.
- `staff`, `admin`, `duper_admin`, `super_admin`: staff/admin surfaces only.

## Verification Separation

- Email verification confirms email ownership.
- Business/profile verification confirms business/profile review state.
- Insurance verification confirms non-expired insurance state for Parking Pass booking eligibility.
- Claim verification confirms ownership/claim relationship.
- None of these states may be collapsed into a single generic “verified” flag for routing.

## Account Setup Failure States

- Missing token while unauthenticated: show `Setup Link Required` and provide `Go to Login`.
- Missing token while authenticated: immediately continue to the normal dashboard/continuation target; do not show `Setup Link Required`, setup-link UI, or account handoff as the final state.
- Invalid token: show invalid setup link message.
- Expired token: show invalid/expired setup link message using backend `Token has expired` state.
- Used token: show already-used/invalid setup link message using backend `Token not found or already used` or complete-setup `Account has already been set up`.
- Authenticated user mismatch: do not silently proceed; use login/verification continuation rather than token setup.

## Known Danger Zones

- `/account-setup` must not be used as an OAuth fallback or account handoff target without a `token`.
- Normal login must not route to `/account-setup` unless a setup token or explicit setup invite context exists.
- OAuth `auth=success` must not be treated as signed in until `/api/auth/user` returns a user.
- Protected account endpoints such as `/api/affiliate/tag` and `/api/business-access/me` must wait for confirmed auth and use same-origin MealScout API routing so session cookies remain aligned.
- `client/src/pages/post-verification.tsx` must reject stored/query redirects back to `/account-setup` unless the URL includes a setup token.
- `server/services/loginContinuation.ts` returns `/account-setup` for incomplete account onboarding; that is only safe when the user has a setup token or a separate authenticated edit/setup route exists.
- OAuth routes in `server/unifiedAuth.ts` must preserve safe redirect/userType intent and call continuation logic when no explicit redirect is present.
- Parking Pass management cannot be blocked by unrelated paid business onboarding gates.
- Admin-created users depend on `server/utils/accountSetup.ts` generating a tokenized `/account-setup` URL.

## Correction In This Slice

- `client/src/pages/account-setup.tsx` now treats missing `token` as a clear failure/escape state instead of showing `Validating setup link...` indefinitely.
- Authenticated users who reach `/account-setup` without a token immediately continue to a safe role/dashboard target rather than seeing setup-link or account-handoff UI.
- OAuth and normal-login redirects reject bare `/account-setup` unless the URL includes a setup token.
- `client/src/hooks/useAuth.ts` keeps OAuth redirects in a pending auth state until `/api/auth/user` confirms the user; a null/401 result clears `auth=success` and routes to login recovery.
- `client/src/lib/api.ts` keeps protected account calls same-origin on MealScout hosts, matching the `/api/auth/user` session-cookie path.
- `client/src/pages/login.tsx` shows a session-not-completed recovery message after failed OAuth confirmation.
- No roles were added.
- No route names were changed.
- No payment, verification, claim, or permission logic was changed.

## Validation

- `node scripts/mealscout-auth-onboarding-alignment.contract.test.ts`
- `node scripts/mealscout-admin-truth-correction.contract.test.ts`
- `node scripts/mealscout-role-admin-display-audit.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`
