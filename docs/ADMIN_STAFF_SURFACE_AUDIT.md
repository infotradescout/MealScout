# Admin and Staff Surface Audit

Last updated: 2026-05-06

Run the audit:

```bash
npm run audit:admin-staff-surfaces
```

The audit inventories:

- Guest `/admin/*` browser routes
- Authenticated `/admin/*` and `/staff` browser routes
- Admin/staff page files under `client/src/pages`
- Server endpoints mounted under `/api/admin/*`, `/api/staff/*`, and admin-mounted routers

Current inventory:

- Guest admin routes: 9, all routed to `AdminLogin`
- Authenticated admin/staff routes: 27, all route-gated
- Admin/staff page files: 22
- Admin/staff server endpoints: 230
- Server guard mix: `admin=96`, `staff_or_admin=130`, `authenticated_inline=4`

## Browser Route Policy

Staff or admin:

- `/staff`
- `/admin/dashboard`
- `/admin/events`
- `/admin/launch-week`
- `/admin/legacy-dashboard`
- `/admin/lead-import`
- `/admin/truck-sightings`
- `/admin/switcher`

Admin only:

- `/admin/incidents`
- `/admin/control-center`
- `/admin/tickets`
- `/admin/moderation`
- `/admin/moderation/queue`
- `/admin/moderation/videos`
- `/admin/moderation/metrics`
- `/admin/moderation/appeals`
- `/admin/audit-logs`
- `/admin/vac-logs`
- `/admin/telemetry`
- `/admin/sentiment-intelligence`
- `/admin/geo-ads`
- `/admin/media/videos`
- `/admin/owner-seo`
- `/admin/affiliates`
- `/admin/oauth-setup`

Authenticated `/admin` and `/admin/login` now redirect by role:

- Admin or super admin: `/admin/dashboard`
- Staff: `/staff`
- Everyone else: `/dashboard`

## Server Policy

Blocking audit failures are reserved for admin/staff API endpoints with no obvious auth or role guard. The current audit passes with zero blocking findings.

The audit also prints a review bucket for mutating `staff_or_admin` endpoints. These are not treated as failures because several staff workflows are intentionally operational, but the list should be reviewed whenever the staff role changes.

## Known Follow-Up Queue

- Decide which staff-writable mutating endpoints should stay staff-accessible and add explicit local staff boundaries or comments where the intent is permanent.
- Add page-level access copy to older admin pages that currently rely on route and API protection only.
- Keep `/admin/events` behind the staff/admin route guard even though the shared events router can render public event content.
