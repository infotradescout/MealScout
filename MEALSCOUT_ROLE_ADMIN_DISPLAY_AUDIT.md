# MealScout Role + Admin Display Audit

Status: `C5B DONE`

This audit is the cleanup authority for admin role display and role-sensitive admin user cards. It uses existing code as the source of truth. Do not invent roles, rename stored role values, or introduce generic role models without explicit compatibility work.

## Source Files Inspected

- `shared/schema.ts` exports the schema modules; `shared/schema/legacy.ts` defines `users.userType` as `user_type` with default `customer`.
- `server/roleAccess.ts` defines the canonical assignable user type allow-list.
- `server/unifiedAuth.ts` maps OAuth, registration, redirects, and middleware roles.
- `server/routes/*` contains provisioning, admin, supplier, host, Parking Pass, profile-access, and operational-readiness checks.
- `client/src/pages/admin-dashboard.tsx` renders admin user cards, role dropdowns, business attachment state, affiliate links, provisioning controls, and Parking Pass admin controls.
- `client/src/hooks/useAuth.ts` applies account/business continuation redirects.
- `client/src/components/dashboard-switcher.tsx` exposes admin/operator dashboard lanes.

## Code-Derived User Type Values

Canonical `userType` values from `server/roleAccess.ts`:

- `customer`
- `restaurant_owner`
- `food_truck`
- `supplier`
- `host`
- `event_coordinator`
- `staff`
- `admin`
- `duper_admin`
- `super_admin`

Schema default:

- `shared/schema/legacy.ts` defaults `users.user_type` to `customer`.

Auth/route-derived behavior:

- `server/unifiedAuth.ts` routes `customer` to customer surfaces, `restaurant_owner`/`food_truck` to business setup, `host` to host setup, `event_coordinator` to events, `supplier` to supplier dashboard, and staff/admin roles to internal surfaces.
- Admin provisioning routes must emit canonical `userType` values. Event coordinator compatibility may still use `event_organizer` as host/location metadata, but not as `users.userType`.

## Admin Role Dropdown Inventory

Admin user-card and user-detail dropdowns in `client/src/pages/admin-dashboard.tsx` should expose only canonical user type values:

- `unknown` as a review-only UI state, not a canonical role.
- `customer` labeled `Customer`.
- `restaurant_owner` labeled `Restaurant Owner`.
- `food_truck` labeled `Food Truck`.
- `host` labeled `Host`.
- `event_coordinator` labeled `Event Coordinator`.
- `staff` labeled `Staff`.
- `admin` labeled `Admin`, visible only to admin-family assigners.
- `duper_admin` labeled `Duper Admin`, visible only to duper/root assigners.
- `super_admin` labeled `Super Admin`, visible only to root super admins.

Do not use a generic `business_owner` user type or primary admin label. Restaurant and truck roles are distinct code values.

## Business Attachment Display Rules

- `customer` accounts do not require business attachment.
- Plain customers must not show `attachment:invalid_missing_business`.
- Plain customers must not show business-only repair controls such as attach business, create business shell, or send monthly business subscription links.
- Business-bearing roles may show missing-business warnings when actually missing required records: `restaurant_owner`, `food_truck`, `host`, `event_coordinator`, `supplier`.
- Restaurant/truck repair controls remain limited to existing restaurant/truck attachment flows unless separately scoped.
- Email verification display remains independent of business attachment.

## Affiliate Link Display Rules

Affiliate tag is an internal token. The normal operator-facing admin UI must show the usable share URL.

Required display for a user with `affiliateTag = user8530`:

```text
Affiliate Link
https://www.mealscout.us/?ref=user8530
[Copy Link] [Open Link]
```

Rules:

- Display `Affiliate Link`, not primary `Affiliate Tag`.
- Build the canonical MealScout URL with the existing `?ref=` attribution format.
- Provide `Copy Link` and `Open Link` controls.
- Do not generate fake affiliate tags.
- For users without a tag, show `No affiliate link assigned`.
- Do not change attribution, commission, payout, or referral mutation logic.

## Parking Pass Access Boundary

Parking Pass has its own booking, host, and management checks. Do not let unrelated setup checks block complete profile access.

Guarded behavior:

- `client/src/hooks/useAuth.ts` must not redirect all `/parking-pass` traffic to restaurant business setup solely because `businessOnboardingRequired` is true.
- Parking Pass booking eligibility remains enforced in Parking Pass/host routes, including food-truck role, email/business insurance requirements, and non-expired stored insurance verification where booking requires it.
- Paid business-feature gates such as deal creation, analytics, social posting, or online ordering must not be reused as Parking Pass management gates unless explicitly scoped.

## Admin Display Fix Status

- Customer missing-business warning: corrected.
- Customer business-only controls: corrected.
- Affiliate link display: corrected to full URL with copy/open controls.
- Raw affiliate tag as primary UI: removed from admin user detail.
- Role dropdown labels: corrected to canonical product lanes.
- Non-canonical `event_organizer` user type in admin provisioning: corrected to `event_coordinator` while preserving compatible host/location metadata.
- Parking Pass auth-hook redirect: corrected so Parking Pass is not blocked by unrelated business setup redirect.

## Validation

- `node scripts/mealscout-role-admin-display-audit.contract.test.ts`
- `node scripts/admin-user-role-business-attachment.contract.test.ts`
- `node scripts/mealscout-affiliate-link-display.contract.test.ts`
- `node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts`
- `node scripts/mealscout-route-map.contract.test.ts`
- `node scripts/repoDoctor.mjs`
- `npm run gate:production`
- `npm run check`
- `npm run build`
