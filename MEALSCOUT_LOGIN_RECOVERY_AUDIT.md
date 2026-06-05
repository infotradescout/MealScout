# MealScout Login Recovery Audit

Status: `LOGIN RECOVERY HOTFIX + NORMAL LOGIN EMAIL GUARD`

This audit documents the current login recovery path for production support. It does not introduce a new auth model, role model, onboarding model, payment model, affiliate model, Parking Pass behavior, fake users, or sample data.

## Incident

A real user reported that login said the password was wrong and the app did not offer a reset or forgot-password path. The user was blocked from using MealScout.

Follow-up objection: after exposing login recovery, a normal privileged login was reported to have triggered a password reset email. That must not happen. Login recovery links are navigation-only; reset email creation is allowed only after an explicit `/forgot-password` form submit.

## Current Code Says

- `client/src/App.tsx` registers `/forgot-password`, `/reset-password`, and `/change-password`.
- `client/src/hooks/useAuth.ts` redirects users with `requiresPasswordReset` to `/change-password`.
- `client/src/pages/forgot-password.tsx` posts to `/api/auth/forgot-password`.
- `client/src/pages/reset-password.tsx` validates reset tokens with `/api/auth/reset-password/validate` and submits new passwords to `/api/auth/reset-password`.
- `server/unifiedAuth.ts` exposes `/api/auth/forgot-password`, `/api/auth/reset-password/validate`, and `/api/auth/reset-password`.
- `server/unifiedAuth.ts` also exposes `/api/auth/resend-verification` for unverified accounts.
- `server/emailService.ts` includes the existing password reset email template and sender.
- `shared/schema.ts` exposes the existing password reset token schema through the shared schema exports.

## Current UI Showed

- Login included a `/forgot-password` link inside the expanded email/password form.
- The initial login-options view did not clearly expose password recovery.
- The wrong-password toast could end at `Invalid email or password.` without a visible recovery prompt tied to the failure state.

## Correction

- Login options now include a visible `/forgot-password` recovery link.
- Failed email/password login now shows inline recovery help with a `/forgot-password` reset link.
- Login and admin login recovery links are marked navigation-only and do not submit `/api/auth/forgot-password`.
- The existing reset endpoints remain the only reset system.
- No role, Parking Pass, affiliate, payout, verification, pricing, or onboarding behavior was changed.

## Normal Login Email Guard

- Normal successful login posts only to `/api/auth/login`; it must not call `/api/auth/forgot-password`.
- Super admin/admin login uses the same login endpoint and must not send a reset email unless the user explicitly navigates to `/forgot-password` and submits the reset form.
- Wrong-password rendering may show recovery copy and a `/forgot-password` link, but must not submit a reset request.
- `requiresPasswordReset` may route to `/change-password`; it must not generate or email a password reset token.
- `server/unifiedAuth.ts` sends password reset email only inside `POST /api/auth/forgot-password`.

## Privacy Rule

Password reset requests must not reveal whether an email exists. `server/unifiedAuth.ts` returns the same generic success message when:

- no user exists for the email,
- the user exists but has no email/password login,
- email delivery is unavailable,
- the reset email is queued for an eligible user.

## Reset Token Rule

Password reset tokens use secure random token material, store only a hash, expire after one hour, and are marked used after password reset.

## Unverified / Partial Account Recovery

- If login returns `email_not_verified`, the login page exposes the existing resend verification action.
- Resend verification is public and non-enumerating.
- Account setup token recovery remains separate from password reset.

## Guard

`scripts/mealscout-login-recovery.contract.test.ts` guards:

- route registration for `/forgot-password`, `/reset-password`, and `/change-password`,
- visible login recovery links,
- wrong-password recovery copy,
- passive navigation-only recovery links on public and admin login,
- no automatic forgot-password/reset email call from login render, login failure, login success, admin/super_admin login, or forced password reset routing,
- password reset email sending only from the explicit forgot-password endpoint,
- generic reset request response,
- reset token expiry,
- forced password reset routing,
- no role, Parking Pass, affiliate, payout, fake-user, or sample-data changes.
