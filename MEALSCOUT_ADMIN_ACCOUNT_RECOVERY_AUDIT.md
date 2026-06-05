# MealScout Admin Account Recovery Audit

Status: Admin account recovery tools added as a safe recovery slice.

## Incident Report

1. Passwords are stored as hashes only. Existing login and reset flows compare or replace `passwordHash`; no plaintext password path exists.
2. Admin API responses must not expose `passwordHash`, password reset tokens, OAuth access tokens, session secrets, or recovery secrets. The existing sanitizer strips credential secrets; this slice adds safe derived diagnostics instead of returning hash fields.
3. The admin user card previously showed general email/account status and activity. It now shows an `ACCOUNT RECOVERY` section with safe facts only: email verified, auth provider, password login enabled, force-reset status, last active, and account status.
4. Public forgot-password and reset-password endpoints already exist: `/api/auth/forgot-password`, `/api/auth/reset-password/validate`, and `/api/auth/reset-password`.
5. A new admin-only `POST /api/admin/users/:id/send-password-reset` action reuses the existing reset-token storage and email sender, returns only a generic message, and never returns the token.
6. A new admin-only `POST /api/admin/users/:id/force-password-reset` action sets the existing `mustResetPassword` flag only for password-login accounts.
7. Admin resend verification already existed at `POST /api/admin/users/:id/resend-verification` and remains the verification recovery action.

## Safe Recovery Surface

- Admins can view whether email is verified.
- Admins can view auth provider as `password`, `Google`, `Facebook`, or `unknown`.
- Admins can view whether local password login is enabled through `hasPasswordLogin`.
- Admins can view whether password reset is required through `requiresPasswordReset`.
- Admins can view last active and account status from existing admin user/activity data.
- Admins can send a password reset link without seeing the reset token.
- Admins can force password reset on next login without seeing or changing the password directly.
- Admins can resend verification email without exposing the verification token.

## Hard Boundaries

- No plaintext passwords are exposed.
- No password hashes are exposed in admin UI or API responses.
- No reset tokens are exposed in admin UI or API responses.
- No OAuth access tokens are exposed.
- No session secrets or recovery secrets are exposed.
- No role, Parking Pass, affiliate, payout, registration, onboarding, or payment behavior was changed.
- No fake users, fake tags, sample data, fake analytics, or placeholder records were created.

## Files Changed

- `server/routes/admin/adminCoreOpsRoutes.ts` derives safe auth diagnostics before sanitizing admin user rows.
- `server/routes/admin/userAdminRoutes.ts` adds admin-only send password reset and force password reset actions.
- `client/src/pages/admin-dashboard.tsx` renders the safe account recovery section and uses safe admin recovery actions.
- `scripts/mealscout-admin-account-recovery.contract.test.ts` guards the recovery surface and secret boundaries.
