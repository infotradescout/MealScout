# MealScout Clean URL Doctrine

Date: 2026-06-11
Branch: `codex/clean-url-doctrine`

## Product Rule

All public and user-facing MealScout URLs must describe the destination a person understands.

Public URLs must not expose database structure, route mechanics, raw internal route families, redirect plumbing, or implementation-only identities when a cleaner public route can be used.

Location is context data, not the permanent public identity of a business profile.

## Target Canonical Shape

MealScout's target public profile architecture is:

- `/{businessSlug}`
- `/{businessSlug}/menu`
- `/{businessSlug}/schedule`
- `/{businessSlug}/deals`

That is the destination doctrine.

## Stage 1 Migration Rule

Until root-level slug routing, reserved-slug protection, and collision-safe slug issuance are fully in place, launch-critical user-facing outputs must move onto cleaner public route families and must stop using `/p/...` as the final shared/copied/QR/marketing/onboarding output.

Stage 1 canonical public route families:

- `/restaurant/{slug}--{id}`
- `/truck/{slug}--{id}`
- `/bar/{slug}--{id}`
- `/location/{slug}--{id}`
- `/supplier/{slug}--{id}`

These are migration routes, not the final doctrine end state.

## Banned As Final User-Facing Output

Unless explicitly internal, admin-only, API-only, or legacy fallback:

- `/p/location`
- `/p/restaurant`
- `/p/truck`
- `/p/bar`
- `/p/supplier`
- `/referral-redirect`
- raw admin/dashboard route shapes
- internal route names
- nested redirect mechanics
- token-looking setup URLs when a safer continuation URL exists

## Allowed Buckets

`clean public/user-facing`

- public profile routes intended for human navigation, sharing, QR, onboarding, or marketing

`acceptable internal/admin/API`

- `/api/*`
- `/admin/*`
- `/staff/*`
- auth/setup/continuation internals that are not final public outputs

`legacy/backward-compatible only`

- existing `/p/:profileType/:profileId/:profileSlug`
- legacy `/ref/:tag?to=...`
- old route-family forms kept only so old links continue to resolve

## Reserved Route Rule

Static app routes must win over business slug routes.

Reserved public or internal paths include:

- `/`
- `/login`
- `/dashboard`
- `/claim`
- `/claim-truck`
- `/account-setup`
- `/post-verification`
- `/businesses`
- `/restaurants`
- `/trucks`
- `/admin`
- `/api`
- `/p`
- `/ref`

And any existing static route already defined in the app router.

## Attribution Rule

Clean public URLs must preserve referral and attribution behavior:

- share preserves attribution
- copy preserves attribution
- QR preserves attribution when attribution exists
- invalid/default `userNNNN` tags remain rejected
- no default/system attribution fallback

## Legacy Rule

Legacy `/p/...` routes may remain for compatibility and redirect/resolve support, but they must stop being treated as canonical final outputs for launch-critical user-facing surfaces.
