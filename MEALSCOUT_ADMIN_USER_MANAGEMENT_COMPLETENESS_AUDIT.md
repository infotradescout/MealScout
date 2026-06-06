# MealScout Admin User Management Completeness Audit

Status: `Admin User Management Completeness Audit + Patch`

Scope: Admin user card completeness only. No runtime behavior changes, no endpoint contract changes, no role/policy rewrites.

## 1) What The Current User Card Already Shows

- `client/src/pages/admin-dashboard.tsx` user details dialog includes identity basics (name, email, phone, user type, verification, active state).
- Existing operator edit controls remain in-card (email, names, phone, postal code, birth year, gender, user type, active, email verification).
- Existing account recovery controls remain in-card:
  - `Send Password Reset`
  - `Force Password Reset`
  - `Resend Verification`
- Existing activity panels remain in-card:
  - account created/updated/last active
  - total events + 7-day volume
  - signal summary, journey summary, top event types, recent activity history
- Existing affiliate section remains in-card for eligible non-admin users:
  - canonical `https://www.mealscout.us/?ref=<affiliateTag>` link
  - copy/open actions
  - internal token metadata
  - editable supported settings (`affiliatePercent`, `affiliateCloserUserId`, `affiliateBookerUserId`)
- Existing linked-record sections remain in-card (addresses, restaurants/trucks, hosts, parking pass records, events/deals context).

## 2) What Is Available Via Existing Admin APIs

- `server/routes/admin/adminCoreOpsRoutes.ts`:
  - `GET /api/admin/users` returns sanitized users with safe auth diagnostics and business linkage context.
- `server/routes/admin/userAdminRoutes.ts` provides selected-user operations already consumed by the card:
  - `PATCH /api/admin/users/:id`
  - `PATCH /api/admin/users/:id/status`
  - `POST /api/admin/users/:id/resend-verification`
  - `POST /api/admin/users/:id/send-password-reset`
  - `POST /api/admin/users/:id/force-password-reset`
  - `GET /api/admin/users/:id/activity`
  - `GET /api/admin/users/:id/restaurants`
  - `GET /api/admin/users/:id/hosts`
  - `GET /api/admin/users/:id/parking-pass`
  - `GET /api/admin/users/:id/parking-pass-bookings`
  - `GET /api/admin/users/:id/addresses`
- `server/routes/admin/affiliateAdminRoutes.ts` supports existing single-user affiliate settings update used by card.

## 3) Missing-But-Supported Before Patch

These were supportable with current data/actions but not explicit enough in the user card UX:

- Clear separation between internal admin navigation links and public/share links.
- A dedicated public/support links section per selected user.
- A compact linked-entity summary block for faster operator triage.
- Explicit parking-pass context hints by user type in the same card.

## 4) Missing Entirely (Documented Unsupported)

- Per-user outbound email delivery attempt log endpoint for reset/verification traffic.
- Admin endpoint to create/regenerate/remove affiliate tags for arbitrary users.
- Dedicated public URL object for every account type (for example customer profile URL) from backend.

These remain unsupported and are not faked in UI.

## 5) Safe-To-Expose Actions

- Existing recovery actions already implemented by backend:
  - resend verification
  - send reset email
  - force reset on next login
- Existing affiliate settings update actions already implemented by backend.
- Public profile open/copy only when a real profile path can be derived.
- Internal admin user view link, clearly labeled internal only.

## 6) Role/User-Type Visibility Rules

- Internal admin-family users (`admin`, `duper_admin`, `super_admin`) do not get affiliate-link controls.
- Customer users are not treated as business-bearing users and should not be flagged for missing business linkage.
- Food-truck users receive truck-owner setup and parking-pass context; host-only management controls are not implied.

## 7) Internal/Debug Fields (Operator-Only)

- Internal token display in affiliate section is metadata-only.
- Identity resolver conflict/signal cards are operator diagnostics.
- Closer/booker affiliate IDs are internal relationship context.

## 8) Forbidden Secret Exposure Check

- Card must never render password hashes, reset tokens, OAuth access/refresh tokens, session tokens, or provider secrets.
- `/api/admin/users` uses safe auth diagnostics booleans/provider labels and does not return secret material.
- Recovery routes generate/reset tokens server-side without exposing token payloads in admin UI.

## Patch Outcome

`client/src/pages/admin-dashboard.tsx` now adds explicit completeness blocks while preserving behavior:

- `ACCOUNT IDENTITY` label and clearer operator framing.
- `PUBLIC + SUPPORT LINKS` section:
  - `Open Admin User View` marked internal-only.
  - public profile link open/copy when available.
  - customer discovery shortcut (`/scout`) for customer accounts.
- `LINKED ENTITIES` section:
  - restaurants/trucks, hosts, parking-pass listing counts.
  - concise relationship/role context.
  - parking-pass flow hints by account type (`food_truck` vs `host`).
- Activity section now explicitly states email-attempt logs are not currently exposed by dedicated endpoint.

No backend route behavior was changed.
