# Backend Refactor Plan

This plan turns the current hotspot audit into an execution order that reduces backend risk without changing product behavior or database shape.

## Goals

- Shrink the blast radius of changes in `server/routes.ts`, `server/storage.ts`, and `shared/schema.ts`.
- Move runtime orchestration out of request registration files.
- Preserve current route paths, storage signatures, and schema contracts during the first pass.
- Make future feature work safer by creating clear module ownership boundaries.

## Current Hotspots

- `server/routes.ts` remains the central API/bootstrap monolith.
- `server/storage.ts` remains the central persistence monolith.
- `shared/schema.ts` remains the central schema/types monolith.
- Scheduler and cron registration are split across `server/routes.ts` and `server/index.ts`.
- Some compliance/static handlers exist in both `server/index.ts` and `server/routes.ts`.

## Progress Updates

- Phase 1 startup extraction is in place: schedulers, static/compliance pages, operational endpoints, and recurring startup jobs are wired through `server/bootstrap/*` modules.
- Phase 3 started: auth-token lifecycle methods were extracted from `server/storage.ts` into `server/storage/authTokensRepository.ts` while keeping `IStorage` and `DatabaseStorage` public method signatures unchanged.

## Guardrails

- Do not change database schema as part of the first refactor wave.
- Do not rename public API routes unless there is a production bug requiring it.
- Keep `IStorage` stable while moving implementation code behind it.
- Prefer extraction plus re-export over broad rewrites.
- After each step, run at minimum `npm run check`.

## Phase 1: Isolate Runtime Wiring

Purpose: separate startup concerns from route registration before touching domain logic.

### Target outcome

- `server/index.ts` becomes the only startup/orchestration entry.
- Cron and recurring job wiring live in dedicated modules.
- Static/compliance page registration has one canonical home.

### File targets

- New: `server/bootstrap/registerSchedulers.ts`
- New: `server/bootstrap/registerStaticPages.ts`
- New: `server/bootstrap/registerOperationalEndpoints.ts`
- Update: `server/index.ts`
- Update: `server/routes.ts`

### Moves

1. Move cron registration blocks out of `server/routes.ts` into `server/bootstrap/registerSchedulers.ts`.
2. Move `setInterval`-based recurring jobs in `server/index.ts` into the same bootstrap layer or sibling modules by concern.
3. Move compliance/static page handlers such as privacy policy, data deletion, and SSR-ish static endpoints into `server/bootstrap/registerStaticPages.ts`.
4. Leave a thin call site in `server/index.ts` that invokes the extracted registration helpers.

### Verification

- `npm run check`
- Manual smoke: app boots, `/health` responds, one static page still renders, one cron registration path still logs on startup

## Phase 2: Finish Route Decomposition

Purpose: reduce `server/routes.ts` to a composition root instead of a feature implementation file.

### Target outcome

- `server/routes.ts` mainly wires domain route registrars plus shared middleware.
- Remaining inline route groups are extracted by domain.

### Extraction order

1. Auth/session/account
2. SEO/sitemaps/public compliance pages
3. Upload/media endpoints
4. Analytics/reporting helpers
5. Parking-pass operational/admin routes that still live centrally

### Suggested file targets

- New: `server/routes/authAccountRoutes.ts`
- New: `server/routes/seoRoutes.ts`
- New: `server/routes/mediaRoutes.ts`
- New: `server/routes/analyticsRoutes.ts`
- New: `server/routes/parkingPassOpsRoutes.ts`
- Update: `server/routes.ts`

### Notes

- Do not keep extracting giant files into other giant files. If a route area is already large, split by subdomain on day one.
- `server/routes/adminManagementRoutes.ts`, `server/routes/supplierMarketplaceRoutes.ts`, and `server/routes/hostRoutes.ts` are already large enough that future work there should use sub-modules, not just add more handlers inline.

### Verification

- `npm run check`
- Spot-check one endpoint from each extracted registrar

## Phase 3: Split Storage by Domain Behind `IStorage`

Purpose: keep existing callers stable while reducing the cost of working in persistence code.

### Target outcome

- `server/storage.ts` becomes a facade plus shared helpers.
- Domain-specific query logic moves into repository-style modules.

### Suggested module layout

- New: `server/storage/usersRepository.ts`
- New: `server/storage/hostsEventsRepository.ts`
- New: `server/storage/restaurantsDealsRepository.ts`
- New: `server/storage/authTokensRepository.ts`
- New: `server/storage/analyticsRepository.ts`
- New: `server/storage/parkingPassRepository.ts`
- New: `server/storage/shared.ts`
- Update: `server/storage.ts`

### Extraction order

1. Auth token lifecycle methods
2. Host and event operations
3. Restaurant and deal operations
4. Analytics/reporting queries
5. Parking-pass and marketplace-specific persistence helpers

### Notes

- Start with cohesive, low-dependency method clusters.
- Move helper functions first, then method bodies, then shared imports/constants.
- Keep one integration surface: `storage` should still export the same concrete implementation shape during the first wave.

### Verification

- `npm run check`
- Run one representative script touching storage-heavy flows if env is available

## Phase 4: Break Up Oversized Extracted Route Modules

Purpose: avoid recreating the monolith inside `server/routes/`.

### Immediate candidates

- `server/routes/adminManagementRoutes.ts`
- `server/routes/supplierMarketplaceRoutes.ts`
- `server/routes/hostRoutes.ts`

### Suggested splits

- Admin
  - `server/routes/admin/usersRoutes.ts`
  - `server/routes/admin/contentModerationRoutes.ts`
  - `server/routes/admin/metricsRoutes.ts`
  - `server/routes/admin/geoAuditRoutes.ts`
- Supplier marketplace
  - `server/routes/suppliers/catalogRoutes.ts`
  - `server/routes/suppliers/ordersRoutes.ts`
  - `server/routes/suppliers/paymentsRoutes.ts`
- Host
  - `server/routes/hosts/profileRoutes.ts`
  - `server/routes/hosts/eventsRoutes.ts`
  - `server/routes/hosts/parkingPassRoutes.ts`

### Verification

- `npm run check`
- Exercise one route per new subgroup

## Phase 5: Modularize Shared Schema Without Changing Imports

Purpose: improve maintainability of the schema/types layer after runtime seams are safer.

### Target outcome

- `shared/schema.ts` becomes an export barrel.
- Table groups live in focused files by domain.

### Suggested layout

- New: `shared/schema/core.ts`
- New: `shared/schema/users.ts`
- New: `shared/schema/restaurants.ts`
- New: `shared/schema/deals.ts`
- New: `shared/schema/hosts.ts`
- New: `shared/schema/events.ts`
- New: `shared/schema/parkingPass.ts`
- New: `shared/schema/admin.ts`
- Update: `shared/schema.ts`

### Notes

- Preserve the `@shared/schema` import path during the first pass.
- Do not mix schema modularization with table redesign or field renaming.

### Verification

- `npm run check`
- Run build if a schema split touches client/server shared type resolution

## Suggested Execution Sequence

1. Phase 1: runtime wiring
2. Phase 2: remaining route decomposition
3. Phase 3: storage split behind `IStorage`
4. Phase 4: oversized extracted route modules
5. Phase 5: schema modularization

## Definition of Done Per Phase

- Largest touched file gets smaller, not just moved around.
- Entry points become easier to scan.
- No route path changes unless explicitly intended.
- `npm run check` passes.
- README or maintenance docs stay aligned with the new structure.

## Non-Goals for the First Wave

- Replacing Express
- Replacing Drizzle
- Changing deployment targets
- Reworking auth/session architecture
- Database redesign

## Recommended First PR

Start with Phase 1 only:

- Extract scheduler registration from `server/routes.ts`
- Extract recurring startup jobs from `server/index.ts`
- Extract static/compliance page registration into one place

This is the highest-leverage low-risk seam because it reduces startup complexity without forcing domain behavior changes.
