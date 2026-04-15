# MealScout De-Risk Order (Hard Gates)

This is the operational de-risk sequence for MealScout. It is a gate-based plan, not a generic backlog. Work proceeds in order; each gate must close before major expansion resumes.

## Core Architecture Rule

- MealScout is the vertical operating system for food-truck/host/restaurant workflows.
- LISA is an external intelligence system consumed through contracts.
- MealScout must consume LISA interfaces, not host LISA scoring/adjudication cores.

## Gate 1: Freeze Window

### Objective

Stop blast-radius growth while we cut structural seams.

### Policy

- No major feature expansion during this gate sequence.

### Allowed Work

- Bug fixes
- Payment/auth reliability work
- Mobile regression fixes
- Explicit refactor tasks in this plan
- LISA boundary extraction only

### Exit Criteria

- Freeze policy documented and active for one full refactor cycle
- New work items mapped to one of the allowed categories

## Gate 2: Composition Seam

### Objective

Make runtime composition explicit and remove hidden orchestration from route files.

### Target State

- `server/index.ts` is orchestration/bootstrap
- Route files register handlers only
- Startup jobs, schedulers, static/compliance wiring live outside request-layer modules

### Exit Criteria

- Runtime wiring extracted behind dedicated bootstrap modules
- `server/routes.ts` acts as composition root, not cross-domain implementation hub
- `npm run check` passes

## Gate 3: Storage Seam

### Objective

Cut the persistence monolith into domain repositories without breaking current interfaces.

### Minimum Domain Split

- Auth/session
- Marketplace core
- Payments/subscriptions
- Intel read models

### Exit Criteria

- `server/storage.ts` becomes facade/shared helpers, not full implementation monolith
- Domain repositories own query logic by responsibility
- `IStorage` remains stable during extraction wave
- `npm run check` passes

## Gate 4: LISA Boundary

### Objective

Protect MealScout from intelligence-core sprawl by enforcing contract boundaries.

### MealScout Should Own

- LISA contracts
- LISA adapters/read-write interfaces
- Operator-facing outputs (briefs, packets, observed-event outputs)

### MealScout Should Not Own

- LISA scoring core
- Signal adjudication core
- Contradiction resolution core
- Source normalization core

### Exit Criteria

- Intelligence touchpoints route through explicit adapter/contracts
- No new LISA-core logic lands in app-domain modules
- Operator outputs are generated from defined interfaces, not hidden glue logic

## Gate 5: SLO Protection

### Objective

Ensure refactor success is measured by business-critical reliability, not code aesthetics.

### Track Before/After Each Refactor Step

- Auth success/failure rate
- Booking completion rate
- Payment success/failure rate
- Mobile responsiveness (key screens)
- Core route latency

### Exit Criteria

- No sustained regression across primary SLOs
- Any negative movement has rollback/mitigation plan before proceeding

## Operating Rules

- If a gate is not closed, do not open new major feature streams.
- If SLOs degrade, pause and stabilize before continuing.
- If a change blurs MealScout/LISA boundaries, redesign before merge.

## Why This Order

1. Freeze prevents risk growth.
2. Composition seam clarifies runtime behavior safely.
3. Storage seam reduces cross-domain persistence coupling.
4. LISA boundary protects long-term architecture.
5. SLO protection ensures refactor quality is real, not cosmetic.
