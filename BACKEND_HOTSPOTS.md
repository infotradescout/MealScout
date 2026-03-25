# Backend Hotspots

This repo's backend already has some route domain extraction under `server/routes/`, but two files still carry most of the long-tail complexity:

- `server/routes.ts` - central bootstrap plus many cross-domain routes, auth-adjacent checks, and startup concerns.
- `server/storage.ts` - very large `DatabaseStorage` implementation spanning hosts, events, restaurants, deals, auth tokens, analytics, and parking-pass flows.

Current low-risk seam carved out
- Environment/bootstrap validation moved into `server/startup/envValidation.ts` so startup concerns are no longer embedded directly inside `server/routes.ts`.

Next likely seam candidates in `server/routes.ts`
- Auth/session/account endpoints
- Subscription and analytics access helpers
- SEO/static page and compliance page handlers
- Parking-pass operational routes and cron wiring

Next likely seam candidates in `server/storage.ts`
- Host and event operations
- Restaurant and deal operations
- Auth token lifecycle methods
- Analytics/reporting queries

Refactor rule of thumb
- Prefer extracting helper modules or route registration groups with no schema changes first.
- Keep storage method signatures stable while moving domain-specific query blocks into focused modules.
