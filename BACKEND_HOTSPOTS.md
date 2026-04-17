# Backend Hotspots

Post-split status (refactor cycle snapshot: 2026-04-17):

- Completed extractions: admin deals, admin verifications, admin stats/dashboard core ops, host profile, host events/interests, supplier catalog, supplier orders/payments, and payments/subscriptions storage methods.
- Remaining high-risk concentration is now mostly in a small set of oversized files.

Current largest backend hotspots by line count:

- `server/storage.ts` (~5377 lines) - `DatabaseStorage` still spans many domains.
- `server/routes/adminManagementRoutes.ts` (~4023 lines) - admin orchestration remains large despite endpoint extraction.
- `server/routes/eventRoutes.ts` (~2265 lines) - medium-large module with cross-cutting event concerns.
- `server/routes/hostRoutes.ts` (~1802 lines) - reduced after extracting host events/interests module.
- `server/routes/supplierMarketplaceRoutes.ts` (~768 lines) - reduced to route registration and shared supplier helper utilities after extraction of admin supplier-order listing and import/request paths.

Recently carved seam
- Environment/bootstrap validation moved into `server/startup/envValidation.ts` so startup concerns are no longer embedded directly inside `server/routes.ts`.

Next likely seam candidates in `server/routes/adminManagementRoutes.ts`
- remaining audit + operations helper clusters
- truck/admin support paths that still share broad dependency surface

Next likely seam candidates in `server/routes/supplierMarketplaceRoutes.ts`
- residual shared supplier utility helpers used by split route modules
- consider helper-module extraction by concern (pricing snapshots vs demand notifications) for readability

Next likely seam candidates in `server/storage.ts`
- Host and event operations
- Restaurant and deal operations
- Auth token lifecycle methods
- Analytics/reporting queries

Refactor rule of thumb
- Prefer extracting helper modules or route registration groups with no schema changes first.
- Keep storage method signatures stable while moving domain-specific query blocks into focused modules.
